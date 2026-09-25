using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace FactorioSaveRelay.Client;

internal static class CredentialStore
{
    private const uint Generic = 1;
    private const uint LocalMachine = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags, Type;
        public string TargetName;
        public string? Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredRead(string target, uint type, uint reserved, out IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    private static string Target(string address, string profile)
    {
        var normalized = $"{address.Trim().TrimEnd('/').ToLowerInvariant()}|{profile.Trim().ToLowerInvariant()}";
        return "FactorioSaveRelay:local:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
    }

    public static void Save(string address, string profile, string token)
    {
        var bytes = Encoding.Unicode.GetBytes(token);
        if (bytes.Length > 5120) throw new InvalidOperationException("Credential is too large.");
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new Credential { Type = Generic, TargetName = Target(address, profile),
                CredentialBlob = blob, CredentialBlobSize = (uint)bytes.Length,
                Persist = LocalMachine, UserName = profile.Trim() };
            if (!CredWrite(ref credential, 0))
                throw new InvalidOperationException($"Windows Credential Manager could not save this profile ({Marshal.GetLastWin32Error()}).");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            Marshal.FreeHGlobal(blob);
        }
    }

    public static string? Load(string address, string profile)
    {
        if (!CredRead(Target(address, profile), Generic, 0, out var pointer)) return null;
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.CredentialBlobSize == 0) return null;
            return Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
        }
        finally { CredFree(pointer); }
    }

    internal static void Delete(string address, string profile)
    {
        if (!CredDelete(Target(address, profile), Generic, 0))
            throw new InvalidOperationException($"Could not remove test credential ({Marshal.GetLastWin32Error()}).");
    }
}
