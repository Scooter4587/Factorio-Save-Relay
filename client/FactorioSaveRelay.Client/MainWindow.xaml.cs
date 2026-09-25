using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Win32;

namespace FactorioSaveRelay.Client;

public partial class MainWindow : Window
{
    private sealed record WorldChoice(string Id, string Name, string Role, long Revision)
    {
        public override string ToString() => $"{Name} — revision {Revision} ({Role})";
    }
    private sealed record HistoryChoice(long Revision, string Status)
    {
        public override string ToString() => $"Revision {Revision} — {Status}";
    }

    private RelayApi? _api;
    private string? _leaseToken;
    private PendingDownload? _pending;
    private readonly DispatcherTimer _heartbeat = new() { Interval = TimeSpan.FromSeconds(60) };
    private bool _busy;

    public MainWindow()
    {
        InitializeComponent();
        _heartbeat.Tick += HeartbeatTick;
    }

    private RelayApi Api => _api ?? throw new InvalidOperationException("Register or load a local profile first.");
    private WorldChoice World => WorldCombo.SelectedItem as WorldChoice
        ?? throw new InvalidOperationException("Choose a shared world first.");
    private string Lease => _leaseToken ?? throw new InvalidOperationException("Acquire the host lease first.");
    private string SavePath => SafeSaveFiles.CheckTestPath(SavePathBox.Text.Trim());
    private static string Root(string worldId) => $"/v1/worlds/{worldId}";

    private async Task Run(Func<Task> action)
    {
        if (_busy) return;
        _busy = true;
        RootGrid.IsEnabled = false;
        try { await action(); }
        catch (Exception error) { StatusText.Text = error.Message; }
        finally { RootGrid.IsEnabled = true; _busy = false; WorldCombo.IsEnabled = _leaseToken is null; }
    }

    private async void RegisterClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        if (_leaseToken is not null) throw new InvalidOperationException("Release the current host lease before switching profiles.");
        var address = ServiceUrlBox.Text.Trim();
        var profile = ProfileBox.Text.Trim();
        if (profile.Length is < 1 or > 80) throw new InvalidOperationException("Profile name must be 1–80 characters.");
        if (CredentialStore.Load(address, profile) is not null)
            throw new InvalidOperationException("This profile already has a saved credential. Load it instead.");
        using var registration = new RelayApi(address, "", RegistrationKeyBox.Password);
        var result = await registration.JsonAsync(HttpMethod.Post, "/v1/devices/register",
            new { displayName = profile, deviceName = DeviceNameBox.Text.Trim() });
        var token = result.GetProperty("token").GetString()!;
        CredentialStore.Save(address, profile, token);
        RegistrationKeyBox.Clear();
        _api?.Dispose();
        _api = new RelayApi(address, token);
        WorldCombo.Items.Clear(); HistoryCombo.Items.Clear(); _pending = null;
        await RefreshWorldsAsync();
        StatusText.Text = $"Profile {profile} registered. Its credential is in Windows Credential Manager.";
    });

    private async void LoadProfileClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        if (_leaseToken is not null) throw new InvalidOperationException("Release the current host lease before switching profiles.");
        var address = ServiceUrlBox.Text.Trim();
        var profile = ProfileBox.Text.Trim();
        var token = CredentialStore.Load(address, profile)
            ?? throw new InvalidOperationException("No saved credential for this service and profile.");
        var next = new RelayApi(address, token);
        try { await next.JsonAsync(HttpMethod.Get, "/v1/me"); }
        catch { next.Dispose(); throw; }
        _api?.Dispose(); _api = next; _pending = null;
        await RefreshWorldsAsync();
        StatusText.Text = $"Profile {profile} loaded.";
    });

    private async Task RefreshWorldsAsync(string? selectId = null)
    {
        selectId ??= (WorldCombo.SelectedItem as WorldChoice)?.Id;
        var result = await Api.JsonAsync(HttpMethod.Get, "/v1/worlds");
        WorldCombo.Items.Clear();
        foreach (var item in result.GetProperty("worlds").EnumerateArray())
        {
            var choice = new WorldChoice(item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!,
                item.GetProperty("role").GetString()!, item.GetProperty("currentRevision").GetInt64());
            WorldCombo.Items.Add(choice);
            if (choice.Id == selectId) WorldCombo.SelectedItem = choice;
        }
        if (WorldCombo.SelectedItem is null && WorldCombo.Items.Count > 0) WorldCombo.SelectedIndex = 0;
        if (WorldCombo.SelectedItem is not null) await RefreshHistoryAsync();
    }

    private async void CreateWorldClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var created = await Api.JsonAsync(HttpMethod.Post, "/v1/worlds", new { name = WorldNameBox.Text.Trim() });
        await RefreshWorldsAsync(created.GetProperty("world").GetProperty("id").GetString());
        StatusText.Text = "World created. Create an invitation for the second profile.";
    });

    private async void RefreshWorldsClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await RefreshWorldsAsync(); StatusText.Text = "World list refreshed.";
    });

    private async void WorldSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_busy || _api is null || WorldCombo.SelectedItem is null) return;
        await Run(RefreshHistoryAsync);
    }

    private async void CreateInviteClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var result = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/invites");
        InviteBox.Text = result.GetProperty("invite").GetProperty("code").GetString();
        StatusText.Text = "Invitation created. Copy the code into the second profile; it expires in 24 hours.";
    });

    private async void JoinWorldClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var result = await Api.JsonAsync(HttpMethod.Post, "/v1/invites/redeem", new { code = InviteBox.Text.Trim() });
        await RefreshWorldsAsync(result.GetProperty("world").GetProperty("id").GetString());
        InviteBox.Clear(); StatusText.Text = "Joined the shared world.";
    });

    private void ChooseSaveClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var dialog = new SaveFileDialog { Title = "Select an existing test ZIP or a target for a downloaded copy",
                Filter = "ZIP save (*.zip)|*.zip", DefaultExt = ".zip", AddExtension = true,
                OverwritePrompt = false, FileName = "RelayTestCopy.zip" };
            if (dialog.ShowDialog(this) == true)
            {
                SavePathBox.Text = SafeSaveFiles.CheckTestPath(dialog.FileName);
                StatusText.Text = "Test ZIP path selected. The source file will be backed up before replacement.";
            }
        }
        catch (Exception error) { StatusText.Text = error.Message; }
    }

    private async void SyncClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        if (_leaseToken is not null) throw new InvalidOperationException("Release host lease before syncing over this copy.");
        if (_pending is not null) throw new InvalidOperationException("Apply the pending download before starting another one.");
        using var response = await Api.OpenDownloadAsync(Root(World.Id) + "/download");
        _pending = await SafeSaveFiles.StageAsync(response, SavePath);
        if (SafeSaveFiles.FactorioRunning())
        {
            StatusText.Text = "Download verified and staged. Close Factorio, then click Apply pending download.";
            return;
        }
        var backup = await SafeSaveFiles.ApplyAsync(_pending);
        var revision = _pending.Revision;
        _pending = null;
        await RefreshWorldsAsync();
        StatusText.Text = backup is null ? $"Revision {revision} installed as a new test copy."
            : $"Revision {revision} installed. Previous test copy backed up at {backup}";
    });

    private async void ApplyPendingClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var pending = _pending ?? throw new InvalidOperationException("There is no pending download.");
        var backup = await SafeSaveFiles.ApplyAsync(pending);
        _pending = null;
        StatusText.Text = backup is null ? "Verified download installed as a new test copy."
            : $"Verified download installed. Previous test copy backed up at {backup}";
    });

    private async void HostClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        if (_leaseToken is not null) throw new InvalidOperationException("This profile already holds a host lease.");
        var file = SavePath;
        if (!File.Exists(file)) throw new InvalidOperationException("Choose an existing test ZIP before acquiring host lease.");
        await SafeSaveFiles.ValidateZipAsync(file);
        var world = (await Api.JsonAsync(HttpMethod.Get, Root(World.Id))).GetProperty("world");
        var revision = world.GetProperty("currentRevision").GetInt64();
        if (revision > 0)
        {
            var history = await Api.JsonAsync(HttpMethod.Get, Root(World.Id) + "/revisions");
            var current = history.GetProperty("revisions").EnumerateArray().First(r => r.GetProperty("status").GetString() == "current");
            if (await SafeSaveFiles.Sha256Async(file) != current.GetProperty("sha256").GetString())
                throw new InvalidOperationException("This copy differs from the current cloud revision. Sync it before hosting.");
        }
        var acquired = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/lock/acquire", new { expectedRevision = revision });
        _leaseToken = acquired.GetProperty("lease").GetProperty("token").GetString();
        _heartbeat.Start();
        WorldCombo.IsEnabled = false;
        StatusText.Text = "Host lease acquired. Change the selected test ZIP, then upload it. The lease renews every minute.";
    });

    private async void HeartbeatTick(object? sender, EventArgs e)
    {
        if (_leaseToken is null || _api is null || WorldCombo.SelectedItem is not WorldChoice world) return;
        try { await _api.JsonAsync(HttpMethod.Post, Root(world.Id) + "/lock/renew", new { lockToken = _leaseToken }); }
        catch
        {
            _leaseToken = null; _heartbeat.Stop(); WorldCombo.IsEnabled = true;
            StatusText.Text = "Host lease was lost. Stop editing; refresh and sync before hosting again.";
        }
    }

    private async void UploadClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var lease = Lease;
        if (SafeSaveFiles.FactorioRunning()) throw new InvalidOperationException("Close Factorio before manually uploading this test copy.");
        var file = SavePath;
        if (!File.Exists(file)) throw new InvalidOperationException("The selected test ZIP does not exist.");
        // A stable snapshot prevents a changing source from being hashed and sent
        // as two different byte sequences. The chosen original is never modified.
        var snapshot = file + ".relay-upload-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(file, snapshot);
            await SafeSaveFiles.ValidateZipAsync(snapshot);
            var size = new FileInfo(snapshot).Length;
            var sha = await SafeSaveFiles.Sha256Async(snapshot);
            var world = (await Api.JsonAsync(HttpMethod.Get, Root(World.Id))).GetProperty("world");
            var baseRevision = world.GetProperty("currentRevision").GetInt64();
            if (baseRevision > 0)
            {
                var history = await Api.JsonAsync(HttpMethod.Get, Root(World.Id) + "/revisions");
                var current = history.GetProperty("revisions").EnumerateArray()
                    .First(r => r.GetProperty("status").GetString() == "current");
                if (sha == current.GetProperty("sha256").GetString())
                {
                    StatusText.Text = "The selected ZIP is unchanged. No new revision was created.";
                    return;
                }
            }
            var begin = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/uploads/begin",
                new { baseRevision, lockToken = lease, sha256 = sha, fileSize = size });
            var upload = begin.GetProperty("upload");
            await Api.PutZipAsync(upload.GetProperty("contentPath").GetString()!, lease, snapshot);
            var finalized = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/uploads/finalize",
                new { uploadId = upload.GetProperty("id").GetString(), lockToken = lease });
            await RefreshWorldsAsync();
            StatusText.Text = $"ZIP uploaded as revision {finalized.GetProperty("revision").GetProperty("revision").GetInt64()}.";
        }
        finally { if (File.Exists(snapshot)) File.Delete(snapshot); }
    });

    private async void ReleaseClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var lease = Lease;
        _heartbeat.Stop();
        try { await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/lock/release", new { lockToken = lease }); }
        finally { _leaseToken = null; WorldCombo.IsEnabled = true; }
        StatusText.Text = "Host lease released. The other profile can now sync and host.";
    });

    private async Task RefreshHistoryAsync()
    {
        var result = await Api.JsonAsync(HttpMethod.Get, Root(World.Id) + "/revisions");
        HistoryCombo.Items.Clear();
        foreach (var item in result.GetProperty("revisions").EnumerateArray())
            HistoryCombo.Items.Add(new HistoryChoice(item.GetProperty("revision").GetInt64(), item.GetProperty("status").GetString()!));
        if (HistoryCombo.Items.Count > 0) HistoryCombo.SelectedIndex = 0;
    }

    private async void RefreshHistoryClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await RefreshHistoryAsync(); StatusText.Text = "Revision history refreshed.";
    });

    private async void RestoreClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var lease = Lease;
        if (World.Role != "owner") throw new InvalidOperationException("Only the world owner can restore a revision.");
        if (HistoryCombo.SelectedItem is not HistoryChoice selected || selected.Status is not ("archived" or "current"))
            throw new InvalidOperationException("Choose a retained finalized revision to restore.");
        var world = (await Api.JsonAsync(HttpMethod.Get, Root(World.Id))).GetProperty("world");
        var result = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + $"/revisions/{selected.Revision}/restore",
            new { expectedRevision = world.GetProperty("currentRevision").GetInt64(), lockToken = lease });
        await RefreshWorldsAsync();
        StatusText.Text = $"Revision {selected.Revision} copied into new revision {result.GetProperty("revision").GetProperty("revision").GetInt64()}. Release the lease, then sync your test copy before hosting again.";
    });

    protected override void OnClosed(EventArgs e)
    {
        _heartbeat.Stop();
        _api?.Dispose();
        base.OnClosed(e);
    }
}
