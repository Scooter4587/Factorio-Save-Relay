using System.IO.Compression;
using System.Net.Http;
using FactorioSaveRelay.Client;

internal static class LocalFlow
{
    private static byte[] Zip(string text)
    {
        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(archive.CreateEntry("synthetic/level.dat").Open())) writer.Write(text);
        return buffer.ToArray();
    }

    public static async Task RunAsync(string folder)
    {
        const string address = "http://127.0.0.1:8787";
        using var registrar = new RelayApi(address, "");
        var adam = await registrar.JsonAsync(HttpMethod.Post, "/v1/devices/register",
            new { displayName = "Client test Adam", deviceName = "Test A" });
        var friend = await registrar.JsonAsync(HttpMethod.Post, "/v1/devices/register",
            new { displayName = "Client test Friend", deviceName = "Test B" });
        using var a = new RelayApi(address, adam.GetProperty("token").GetString()!);
        using var b = new RelayApi(address, friend.GetProperty("token").GetString()!);
        var created = await a.JsonAsync(HttpMethod.Post, "/v1/worlds", new { name = "Disposable client test" });
        var root = "/v1/worlds/" + created.GetProperty("world").GetProperty("id").GetString();
        var invite = await a.JsonAsync(HttpMethod.Post, root + "/invites");
        await b.JsonAsync(HttpMethod.Post, "/v1/invites/redeem", new { code = invite.GetProperty("invite").GetProperty("code").GetString() });

        var aFile = Path.Combine(folder, "adam-copy.zip");
        var bFile = Path.Combine(folder, "friend-copy.zip");
        await File.WriteAllBytesAsync(aFile, Zip("Adam starts a synthetic world"));
        await File.WriteAllBytesAsync(bFile, Zip("Friend has an old local copy"));
        var first = await a.JsonAsync(HttpMethod.Post, root + "/lock/acquire", new { expectedRevision = 0 });
        var aLease = first.GetProperty("lease").GetProperty("token").GetString()!;
        var firstRevision = await Upload(a, root, aLease, aFile, 0);
        await a.JsonAsync(HttpMethod.Post, root + "/lock/release", new { lockToken = aLease });
        using (var response = await b.OpenDownloadAsync(root + "/download"))
        {
            var pending = await SafeSaveFiles.StageAsync(response, bFile);
            var backup = await SafeSaveFiles.ApplyAsync(pending, () => false);
            if (backup is null || !File.Exists(backup)) throw new Exception("Client integration backup missing.");
            var adamBytes = await File.ReadAllBytesAsync(aFile);
            var friendBytes = await File.ReadAllBytesAsync(bFile);
            if (!adamBytes.SequenceEqual(friendBytes))
                throw new Exception("First client transfer differs.");
        }
        var secondLeaseResult = await b.JsonAsync(HttpMethod.Post, root + "/lock/acquire", new { expectedRevision = firstRevision });
        var bLease = secondLeaseResult.GetProperty("lease").GetProperty("token").GetString()!;
        await File.WriteAllBytesAsync(bFile, Zip("Friend publishes a newer synthetic revision"));
        var secondRevision = await Upload(b, root, bLease, bFile, firstRevision);
        await b.JsonAsync(HttpMethod.Post, root + "/lock/release", new { lockToken = bLease });
        using (var response = await a.OpenDownloadAsync(root + "/download"))
        {
            var pending = await SafeSaveFiles.StageAsync(response, aFile);
            await SafeSaveFiles.ApplyAsync(pending, () => false);
            var adamBytes = await File.ReadAllBytesAsync(aFile);
            var friendBytes = await File.ReadAllBytesAsync(bFile);
            if (!adamBytes.SequenceEqual(friendBytes))
                throw new Exception("Second client transfer differs.");
        }
        Console.WriteLine($"PASS: Windows client code transferred synthetic revisions {firstRevision} and {secondRevision} in both directions with backups.");
    }

    private static async Task<long> Upload(RelayApi api, string root, string lease, string file, long revision)
    {
        await SafeSaveFiles.ValidateZipAsync(file);
        var created = await api.JsonAsync(HttpMethod.Post, root + "/uploads/begin",
            new { baseRevision = revision, lockToken = lease,
                sha256 = await SafeSaveFiles.Sha256Async(file), fileSize = new FileInfo(file).Length });
        var upload = created.GetProperty("upload");
        await api.PutZipAsync(upload.GetProperty("contentPath").GetString()!, lease, file);
        var finalized = await api.JsonAsync(HttpMethod.Post, root + "/uploads/finalize",
            new { uploadId = upload.GetProperty("id").GetString(), lockToken = lease });
        return finalized.GetProperty("revision").GetProperty("revision").GetInt64();
    }
}
