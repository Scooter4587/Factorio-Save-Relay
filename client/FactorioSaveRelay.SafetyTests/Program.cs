using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using FactorioSaveRelay.Client;

var tempRoot = Path.GetFullPath(Path.GetTempPath());
var root = Path.Combine(tempRoot, "factorio-relay-safety-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
try
{
    static byte[] Zip(string text)
    {
        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(archive.CreateEntry("synthetic/level.dat").Open()))
            writer.Write(text);
        return buffer.ToArray();
    }
    static HttpResponseMessage Download(byte[] bytes, long revision, string? hash = null)
    {
        var result = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
        result.Headers.Add("X-Save-Sha256", hash ?? Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
        result.Headers.Add("X-Save-Revision", revision.ToString());
        return result;
    }
    static void Check(bool result, string message)
    {
        if (!result) throw new Exception(message);
    }

    var realSave = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Factorio", "saves", "world.zip");
    try { SafeSaveFiles.CheckTestPath(realSave); throw new Exception("Real saves folder was accepted."); }
    catch (InvalidOperationException) { }
    var target = Path.Combine(root, "selected-copy.zip");
    var original = Zip("original existing world copy");
    var next = Zip("new revision from the other player");
    await File.WriteAllBytesAsync(target, original);

    using (var bad = Download(next, 2, new string('0', 64)))
    {
        try { await SafeSaveFiles.StageAsync(bad, target); throw new Exception("Corrupt hash was accepted."); }
        catch (InvalidOperationException) { }
    }
    Check((await File.ReadAllBytesAsync(target)).SequenceEqual(original), "Bad download changed the target.");

    PendingDownload pending;
    using (var valid = Download(next, 2)) pending = await SafeSaveFiles.StageAsync(valid, target);
    Check((await File.ReadAllBytesAsync(target)).SequenceEqual(original), "Staging changed the target.");
    Check(File.Exists(pending.Path), "Verified temporary download is missing.");
    try { await SafeSaveFiles.ApplyAsync(pending, () => true); throw new Exception("Running game did not block replacement."); }
    catch (InvalidOperationException) { }
    Check((await File.ReadAllBytesAsync(target)).SequenceEqual(original), "Running-game guard changed the target.");
    var backup = await SafeSaveFiles.ApplyAsync(pending, () => false);
    Check(backup is not null && File.Exists(backup), "Replacement did not create a backup.");
    Check((await File.ReadAllBytesAsync(backup!)).SequenceEqual(original), "Backup does not match original bytes.");
    Check((await File.ReadAllBytesAsync(target)).SequenceEqual(next), "Installed bytes do not match download.");
    Check(!File.Exists(pending.Path), "Temporary download remains after replacement.");

    using (var valid = Download(original, 3)) pending = await SafeSaveFiles.StageAsync(valid, target);
    await File.WriteAllBytesAsync(pending.Path, Zip("tampered after verification"));
    try { await SafeSaveFiles.ApplyAsync(pending, () => false); throw new Exception("Tampered pending download was accepted."); }
    catch (InvalidOperationException) { }
    Check((await File.ReadAllBytesAsync(target)).SequenceEqual(next), "Tampered download changed the target.");
    var profile = "SafetyTest-" + Guid.NewGuid().ToString("N");
    try
    {
        CredentialStore.Save("http://127.0.0.1:8787", profile, "synthetic-test-credential");
        Check(CredentialStore.Load("http://127.0.0.1:8787", profile) == "synthetic-test-credential",
            "Windows Credential Manager did not return the saved test credential.");
        Check(CredentialStore.Load("http://127.0.0.1:8787", profile + "-other") is null,
            "A separate profile could read the test credential.");
    }
    finally { CredentialStore.Delete("http://127.0.0.1:8787", profile); }
    if (args.Contains("--api")) await LocalFlow.RunAsync(root);
    Console.WriteLine("PASS: real saves path blocked; bad download preserved source; verified replacement created an exact backup; tampering was rejected.");
}
finally
{
    if (!Path.GetFullPath(root).StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Test cleanup path escaped the temporary directory.");
    Directory.Delete(root, recursive: true);
}
