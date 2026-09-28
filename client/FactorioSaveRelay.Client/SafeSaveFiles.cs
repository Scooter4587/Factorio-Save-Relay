using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;

namespace FactorioSaveRelay.Client;

internal sealed record PendingDownload(string Path, string Target, string Sha256, long Size, long Revision);

internal static class SafeSaveFiles
{
    private const long MaximumLocalTransfer = 512L * 1024 * 1024;

    public static string FactorioSavesDirectory => Path.GetFullPath(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Factorio", "saves"));

    public static string RelayFileNameFromSource(string source)
    {
        var name = Path.GetFileNameWithoutExtension(source).Trim();
        if (name.Length == 0 || name.EndsWith(" RELAY", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Vyber pôvodný save bez koncovky RELAY.");
        var result = name + " RELAY.zip";
        if (result.Length > 120 || result.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new InvalidOperationException("Názov save je príliš dlhý alebo neplatný pre Windows.");
        return result;
    }

    public static string RelayPath(string fileName)
    {
        if (Path.GetFileName(fileName) != fileName || !fileName.EndsWith(" RELAY.zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Služba vrátila neplatný názov relay save.");
        return CheckRelayPath(Path.Combine(FactorioSavesDirectory, fileName), requireDirectory: false);
    }

    public static string CheckRelayPath(string path, bool requireDirectory = true)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
            throw new InvalidOperationException("Relay save musí mať úplnú cestu.");
        var full = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(full)!;
        if (!string.Equals(directory, FactorioSavesDirectory, StringComparison.OrdinalIgnoreCase)
            || !Path.GetFileName(full).EndsWith(" RELAY.zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Aplikácia môže meniť iba súbor s koncovkou RELAY.zip priamo vo Factorio saves.");
        if (requireDirectory && !Directory.Exists(directory))
            throw new InvalidOperationException("Factorio saves priečinok neexistuje. Najprv aspoň raz spusti Factorio.");
        if (Directory.Exists(directory) && File.GetAttributes(directory).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("Factorio saves priečinok nesmie byť odkaz alebo junction.");
        if (File.Exists(full) && File.GetAttributes(full).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("Relay save nesmie byť odkaz.");
        return full;
    }

    public static string CheckTestPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path))
            throw new InvalidOperationException("Choose a full path to a test ZIP copy.");
        var full = Path.GetFullPath(path);
        if (!full.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Choose a .zip file.");
        if (full.StartsWith(FactorioSavesDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("This test path blocks Factorio saves. Managed files must end in RELAY.zip.");
        var directory = Path.GetDirectoryName(full)!;
        if (!Directory.Exists(directory)) throw new InvalidOperationException("The target folder does not exist.");
        CheckNoLinks(directory, full);
        return full;
    }

    private static string CheckTransferPath(string path)
    {
        var full = Path.GetFullPath(path);
        return full.StartsWith(FactorioSavesDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            ? CheckRelayPath(full) : CheckTestPath(full);
    }

    private static void CheckNoLinks(string directory, string? file = null)
    {
        for (var current = new DirectoryInfo(directory); current is not null; current = current.Parent)
        {
            if (current.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidOperationException("Save path cannot pass through a link or junction.");
        }
        if (file is not null && File.Exists(file) && File.GetAttributes(file).HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("Save ZIP cannot be a link.");
    }

    public static async Task<string> CreateRelayCopyAsync(string source)
    {
        if (FactorioRunning()) throw new InvalidOperationException("Najprv zavri Factorio.");
        source = Path.GetFullPath(source);
        if (!File.Exists(source) || !source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Vyber existujúci Factorio ZIP save.");
        CheckNoLinks(Path.GetDirectoryName(source)!, source);
        await ValidateZipAsync(source);
        var saves = FactorioSavesDirectory;
        if (!Directory.Exists(saves)) throw new InvalidOperationException("Factorio saves priečinok neexistuje. Najprv aspoň raz spusti Factorio.");
        CheckNoLinks(saves);
        var target = CheckRelayPath(Path.Combine(saves, RelayFileNameFromSource(source)));
        if (File.Exists(target)) throw new InvalidOperationException($"{Path.GetFileName(target)} už existuje. Aplikácia ho bez synchronizácie neprepíše.");
        var temporary = target + ".setup-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, temporary, overwrite: false);
            await ValidateZipAsync(temporary);
            if (!string.Equals(await Sha256Async(source), await Sha256Async(temporary), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Relay kópia sa nezhoduje s pôvodným save.");
            File.Move(temporary, target);
            return target;
        }
        catch { if (File.Exists(temporary)) File.Delete(temporary); throw; }
    }

    public static bool FactorioRunning()
    {
        var processes = Process.GetProcessesByName("factorio");
        try { return processes.Any(p => !p.HasExited); }
        finally { foreach (var process in processes) process.Dispose(); }
    }

    public static async Task ValidateZipAsync(string file)
    {
        await using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length < 22 || input.Length > MaximumLocalTransfer)
            throw new InvalidOperationException("ZIP size is outside the local relay limit.");
        using var archive = new ZipArchive(input, ZipArchiveMode.Read, leaveOpen: true);
        if (archive.Entries.Count is < 1 or > 2048) throw new InvalidOperationException("ZIP entry count is unsupported.");
        long expanded = 0;
        foreach (var entry in archive.Entries)
        {
            expanded = checked(expanded + entry.Length);
            if (expanded > 2L * 1024 * 1024 * 1024) throw new InvalidOperationException("ZIP expands beyond the safe limit.");
            await using var data = entry.Open();
            var buffer = new byte[64 * 1024];
            long actual = 0;
            int count;
            while ((count = await data.ReadAsync(buffer)) > 0)
            {
                actual += count;
                if (actual > entry.Length || actual > 2L * 1024 * 1024 * 1024)
                    throw new InvalidOperationException("ZIP entry expands beyond its declared size.");
            }
            if (actual != entry.Length) throw new InvalidOperationException("ZIP entry is truncated.");
        }
    }

    public static async Task<string> Sha256Async(string file)
    {
        await using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexString(await SHA256.HashDataAsync(input)).ToLowerInvariant();
    }

    public static async Task<string?> SnapshotStableAsync(string selectedPath)
    {
        var source = CheckTransferPath(selectedPath);
        var before = new FileInfo(source);
        if (!before.Exists || DateTime.UtcNow - before.LastWriteTimeUtc < TimeSpan.FromSeconds(3)) return null;
        var snapshot = source + ".relay-upload-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, snapshot);
            var after = new FileInfo(source);
            if (!after.Exists || after.Length != before.Length || after.LastWriteTimeUtc != before.LastWriteTimeUtc
                || DateTime.UtcNow - after.LastWriteTimeUtc < TimeSpan.FromSeconds(3))
            {
                File.Delete(snapshot);
                return null;
            }
            await ValidateZipAsync(snapshot);
            return snapshot;
        }
        catch (IOException)
        {
            if (File.Exists(snapshot)) File.Delete(snapshot);
            return null;
        }
        catch
        {
            if (File.Exists(snapshot)) File.Delete(snapshot);
            throw;
        }
    }

    public static async Task<string> SnapshotVerifiedAsync(string selectedPath)
    {
        var source = CheckTransferPath(selectedPath);
        var snapshot = source + ".relay-upload-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, snapshot);
            await ValidateZipAsync(snapshot);
            if (!string.Equals(await Sha256Async(source), await Sha256Async(snapshot), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Pripravená relay kópia sa počas kontroly zmenila.");
            return snapshot;
        }
        catch
        {
            if (File.Exists(snapshot)) File.Delete(snapshot);
            throw;
        }
    }

    public static async Task<PendingDownload> StageAsync(HttpResponseMessage response, string target)
    {
        target = CheckTransferPath(target);
        var size = response.Content.Headers.ContentLength;
        var sha = response.Headers.TryGetValues("X-Save-Sha256", out var hashes) ? hashes.SingleOrDefault() : null;
        var revisionText = response.Headers.TryGetValues("X-Save-Revision", out var revisions) ? revisions.SingleOrDefault() : null;
        if (size is null or < 22 or > MaximumLocalTransfer || sha is null || sha.Length != 64
            || !sha.All(Uri.IsHexDigit) || !long.TryParse(revisionText, out var revision) || revision < 1)
            throw new InvalidOperationException("Server did not provide valid save metadata.");
        var temporary = target + ".download-" + Guid.NewGuid().ToString("N");
        try
        {
            await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            await using (var input = await response.Content.ReadAsStreamAsync())
            {
                var buffer = new byte[64 * 1024];
                long received = 0;
                int count;
                while ((count = await input.ReadAsync(buffer)) > 0)
                {
                    received += count;
                    if (received > size || received > MaximumLocalTransfer)
                        throw new InvalidOperationException("Download exceeds its declared size.");
                    await output.WriteAsync(buffer.AsMemory(0, count));
                }
                await output.FlushAsync();
                if (received != size) throw new InvalidOperationException("Download is incomplete.");
            }
            if (!string.Equals(await Sha256Async(temporary), sha, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Downloaded SHA-256 does not match the server.");
            await ValidateZipAsync(temporary);
            return new PendingDownload(temporary, target, sha.ToLowerInvariant(), size.Value, revision);
        }
        catch { if (File.Exists(temporary)) File.Delete(temporary); throw; }
    }

    private static string BackupPath(string target)
    {
        if (!target.StartsWith(FactorioSavesDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return target + ".relay-backup-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss")
                + "-" + Guid.NewGuid().ToString("N") + ".zip";
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FactorioSaveRelay", "backups", Path.GetFileNameWithoutExtension(target));
        Directory.CreateDirectory(folder);
        return Path.Combine(folder, DateTime.UtcNow.ToString("yyyyMMddHHmmss")
            + "-" + Guid.NewGuid().ToString("N") + ".zip");
    }

    public static async Task<string?> ApplyAsync(PendingDownload pending, Func<bool>? gameRunning = null)
    {
        CheckTransferPath(pending.Target);
        if ((gameRunning ?? FactorioRunning)()) throw new InvalidOperationException("Factorio is running. Close it before applying this download; the verified file remains pending.");
        var info = new FileInfo(pending.Path);
        if (!info.Exists || info.Length != pending.Size || await Sha256Async(pending.Path) != pending.Sha256)
            throw new InvalidOperationException("Pending download changed. Download it again.");
        await ValidateZipAsync(pending.Path);
        if (!File.Exists(pending.Target))
        {
            File.Move(pending.Path, pending.Target);
            return null;
        }
        var backup = BackupPath(pending.Target);
        File.Replace(pending.Path, pending.Target, backup);
        return backup;
    }
}
