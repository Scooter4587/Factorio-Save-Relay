using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Win32;

namespace FactorioSaveRelay.Client;

public partial class MainWindow : Window
{
    private const string ServiceAddress = "https://factorio-save-relay-test.aisoft-sk.workers.dev/";

    private sealed record RelayWorld(string Id, string Name, string Role, long Revision,
        string? RelayFileName, string? HostDeviceId, string? HostDisplayName);

    private RelayApi? _api;
    private RelayWorld? _world;
    private string? _deviceId;
    private string? _profile;
    private string? _leaseToken;
    private string? _cloudHash;
    private string? _hostStartHash;
    private PendingDownload? _pending;
    private FileSystemWatcher? _saveWatcher;
    private (long Size, DateTime Modified, string Hash)? _localFingerprint;
    private bool _factorioSeen;
    private bool _autoUploadPending;
    private bool _busy;
    private DateTime _nextAutoAttempt;
    private readonly DispatcherTimer _heartbeat = new() { Interval = TimeSpan.FromSeconds(60) };
    private readonly DispatcherTimer _savePoll = new() { Interval = TimeSpan.FromSeconds(5) };
    private readonly DispatcherTimer _statePoll = new() { Interval = TimeSpan.FromSeconds(15) };

    public MainWindow()
    {
        InitializeComponent();
        _heartbeat.Tick += HeartbeatTick;
        _savePoll.Tick += SavePollTick;
        _statePoll.Tick += StatePollTick;
        SetupButton.Visibility = Visibility.Collapsed;
        SyncButton.Visibility = Visibility.Collapsed;
        TakeOverButton.Visibility = Visibility.Collapsed;
        ReleaseButton.Visibility = Visibility.Collapsed;
    }

    private RelayApi Api => _api ?? throw new InvalidOperationException("Najprv sa prihlás.");
    private RelayWorld World => _world ?? throw new InvalidOperationException("Najprv vytvor alebo prijmi svet na webe.");
    private string Lease => _leaseToken ?? throw new InvalidOperationException("Tento PC momentálne nehostuje.");
    private string RelayPath => SafeSaveFiles.RelayPath(World.RelayFileName
        ?? throw new InvalidOperationException("Relay save ešte nie je nastavený."));
    private static string Root(string worldId) => $"/v1/worlds/{worldId}";

    private async Task Run(Func<Task> action)
    {
        if (_busy) return;
        _busy = true;
        RootGrid.IsEnabled = false;
        try { await action(); }
        catch (Exception error) { StatusText.Text = error.Message; }
        finally { RootGrid.IsEnabled = true; _busy = false; }
    }

    private async void AccountLoginClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var username = ProfileBox.Text.Trim();
        var password = AccountPasswordBox.Password;
        AccountPasswordBox.Clear();
        if (username.Length == 0 || password.Length == 0)
            throw new InvalidOperationException("Zadaj meno účtu a heslo z webu.");
        using var login = new RelayApi(ServiceAddress, "");
        var result = await login.JsonAsync(HttpMethod.Post, "/v1/accounts/login",
            new { username, password, deviceName = Environment.MachineName });
        var token = result.GetProperty("token").GetString()!;
        CredentialStore.Save(ServiceAddress, username, token);
        await ConnectAsync(username, token);
    });

    private async void LoadProfileClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var username = ProfileBox.Text.Trim();
        var token = CredentialStore.Load(ServiceAddress, username)
            ?? throw new InvalidOperationException("Pre tento účet nie je v počítači uložené prihlásenie.");
        await ConnectAsync(username, token);
    });

    private async Task ConnectAsync(string username, string token)
    {
        var next = new RelayApi(ServiceAddress, token);
        try
        {
            var me = await next.JsonAsync(HttpMethod.Get, "/v1/me");
            _deviceId = me.GetProperty("identity").GetProperty("deviceId").GetString();
        }
        catch { next.Dispose(); throw; }
        _api?.Dispose();
        _api = next;
        _profile = username;
        _pending = null;
        LoginPanel.Visibility = Visibility.Collapsed;
        DashboardPanel.Visibility = Visibility.Visible;
        AccountText.Text = $"Účet {username} · {Environment.MachineName}";
        _statePoll.Start();
        await RefreshStateAsync();
        StatusText.Text = "Prihlásenie je uložené bezpečne v tomto Windows účte.";
    }

    private async Task RefreshStateAsync()
    {
        var listed = await Api.JsonAsync(HttpMethod.Get, "/v1/worlds");
        var worlds = listed.GetProperty("worlds").EnumerateArray().ToArray();
        if (worlds.Length == 0)
        {
            _world = null;
            WorldNameText.Text = "Žiadny spoločný svet";
            StateText.Text = "Dokonči vytvorenie alebo párovanie na webe";
            RelayFileText.Text = "—"; CloudRevisionText.Text = "—"; LocalRevisionText.Text = "—";
            HostText.Text = "Hostiteľ: —";
            HideActions();
            return;
        }
        if (worlds.Length > 1) throw new InvalidOperationException("Tento testovací klient očakáva jeden spoločný svet.");
        var id = worlds[0].GetProperty("id").GetString()!;
        var detail = (await Api.JsonAsync(HttpMethod.Get, Root(id))).GetProperty("world");
        _world = ParseWorld(detail);
        WorldNameText.Text = _world.Name;
        CloudRevisionText.Text = _world.Revision == 0 ? "Bez save" : $"Revízia #{_world.Revision}";
        RelayFileText.Text = _world.RelayFileName ?? "Zatiaľ nenastavený";
        HostText.Text = _world.HostDeviceId is null ? "Hostiteľ: nikto"
            : _world.HostDeviceId == _deviceId ? "Hostiteľ: tento PC"
            : $"Hostiteľ: {_world.HostDisplayName ?? "druhý hráč"}";
        _cloudHash = null;
        if (_world.Revision > 0)
        {
            var history = await Api.JsonAsync(HttpMethod.Get, Root(id) + "/revisions");
            var current = history.GetProperty("revisions").EnumerateArray()
                .First(r => r.GetProperty("status").GetString() == "current");
            _cloudHash = current.GetProperty("sha256").GetString();
        }
        await RenderStateAsync();
    }

    private static RelayWorld ParseWorld(JsonElement item) => new(
        item.GetProperty("id").GetString()!, item.GetProperty("name").GetString()!,
        item.GetProperty("role").GetString()!, item.GetProperty("currentRevision").GetInt64(),
        item.TryGetProperty("relayFileName", out var file) && file.ValueKind != JsonValueKind.Null ? file.GetString() : null,
        item.TryGetProperty("hostDeviceId", out var host) && host.ValueKind != JsonValueKind.Null ? host.GetString() : null,
        item.TryGetProperty("hostDisplayName", out var name) && name.ValueKind != JsonValueKind.Null ? name.GetString() : null);

    private async Task RenderStateAsync()
    {
        HideActions();
        if (_world is null) return;
        if (_world.RelayFileName is null)
        {
            StateText.Text = _world.Role == "owner" ? "Pripravené na prvotné nastavenie" : "Čaká sa na nastavenie vlastníkom";
            LocalRevisionText.Text = "Nenastavené";
            SetupButton.Visibility = _world.Role == "owner" ? Visibility.Visible : Visibility.Collapsed;
            return;
        }
        var path = RelayPath;
        if (!File.Exists(path))
        {
            LocalRevisionText.Text = "Save chýba";
            StateText.Text = _world.Revision > 0 ? "Treba stiahnuť relay save" : "Vlastník musí založiť prvý save";
            SyncButton.Visibility = _world.Revision > 0 ? Visibility.Visible : Visibility.Collapsed;
            return;
        }
        var localHash = await LocalHashAsync(path);
        var synced = _world.Revision > 0 && string.Equals(localHash, _cloudHash, StringComparison.OrdinalIgnoreCase);
        LocalRevisionText.Text = synced ? $"Revízia #{_world.Revision}" : "Lokálne zmeny";
        if (_leaseToken is not null)
        {
            StateText.Text = SafeSaveFiles.FactorioRunning() ? "HOSTUJEŠ · Factorio beží" : "HOSTUJEŠ · čakám na hranie alebo odovzdanie";
            ReleaseButton.Visibility = Visibility.Visible;
            return;
        }
        if (_world.HostDeviceId is not null)
        {
            StateText.Text = _world.HostDeviceId == _deviceId ? "Obnovujem tvoje hostovanie" : $"{_world.HostDisplayName ?? "Druhý hráč"} práve hostuje";
            return;
        }
        if (!synced)
        {
            StateText.Text = _world.Revision > 0 ? "Cloud a tento PC sa nezhodujú" : "Pripravené nahrať prvú verziu";
            SyncButton.Visibility = _world.Revision > 0 ? Visibility.Visible : Visibility.Collapsed;
            if (_world.Revision == 0 && _world.Role == "owner") TakeOverButton.Visibility = Visibility.Visible;
            return;
        }
        StateText.Text = "SYNCHRONIZOVANÉ · môžeš prevziať hostovanie";
        TakeOverButton.Visibility = Visibility.Visible;
    }

    private void HideActions()
    {
        SetupButton.Visibility = Visibility.Collapsed;
        SyncButton.Visibility = Visibility.Collapsed;
        TakeOverButton.Visibility = Visibility.Collapsed;
        ReleaseButton.Visibility = Visibility.Collapsed;
    }

    private async Task<string> LocalHashAsync(string path)
    {
        var info = new FileInfo(path);
        if (_localFingerprint is { } cached && cached.Size == info.Length && cached.Modified == info.LastWriteTimeUtc)
            return cached.Hash;
        var hash = await SafeSaveFiles.Sha256Async(path);
        _localFingerprint = (info.Length, info.LastWriteTimeUtc, hash);
        return hash;
    }

    private async void SetupClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        if (World.Role != "owner") throw new InvalidOperationException("Prvotný relay save nastavuje vlastník sveta.");
        if (SafeSaveFiles.FactorioRunning()) throw new InvalidOperationException("Najprv zavri Factorio.");
        var dialog = new OpenFileDialog { Title = "Vyber pôvodný Factorio save", Filter = "Factorio save (*.zip)|*.zip", CheckFileExists = true };
        if (dialog.ShowDialog(this) != true) return;
        var created = await SafeSaveFiles.CreateRelayCopyAsync(dialog.FileName);
        await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/relay-file", new { fileName = Path.GetFileName(created) });
        _localFingerprint = null;
        await RefreshStateAsync();
        if (World.Revision == 0)
        {
            await AcquireAsync();
            try
            {
                if (!await UploadSelectedAsync(freshlyCreated: true))
                    throw new InvalidOperationException("Prvú relay kópiu sa nepodarilo pripraviť na nahratie.");
                await ReleaseLeaseAsync();
            }
            catch
            {
                await RenderStateAsync();
                throw;
            }
            await RefreshStateAsync();
            StatusText.Text = $"Relay save {Path.GetFileName(created)} bol vytvorený a bezpečne nahraný ako prvá verzia.";
        }
        else
        {
            StatusText.Text = "Relay kópia bola vytvorená. Ak sa nezhoduje s cloudom, použi Synchronizovať.";
        }
    });

    private async void SyncClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await SyncLatestAsync();
        await RefreshStateAsync();
    });

    private async Task SyncLatestAsync()
    {
        if (_leaseToken is not null) throw new InvalidOperationException("Počas hostovania nemožno prepísať lokálny save.");
        if (SafeSaveFiles.FactorioRunning()) throw new InvalidOperationException("Najprv zavri Factorio.");
        if (World.Revision < 1) throw new InvalidOperationException("V cloude ešte nie je žiadny save.");
        StatusText.Text = "Sťahujem a overujem aktuálny save…";
        using var response = await Api.OpenDownloadAsync(Root(World.Id) + "/download");
        _pending = await SafeSaveFiles.StageAsync(response, RelayPath);
        var backup = await SafeSaveFiles.ApplyAsync(_pending);
        var revision = _pending.Revision;
        _pending = null;
        _localFingerprint = null;
        StatusText.Text = backup is null ? $"Revízia #{revision} je pripravená vo Factoriu."
            : $"Revízia #{revision} je pripravená; predchádzajúca relay kópia je v lokálnej zálohe.";
    }

    private async void TakeOverClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await RefreshStateAsync();
        if (World.HostDeviceId is not null) throw new InvalidOperationException("Svet momentálne drží druhý hostiteľ.");
        if (!File.Exists(RelayPath)) throw new InvalidOperationException("Najprv synchronizuj relay save.");
        var localHash = await LocalHashAsync(RelayPath);
        if (World.Revision > 0 && !string.Equals(localHash, _cloudHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Lokálny save sa nezhoduje s cloudom. Najprv ho synchronizuj.");
        await AcquireAsync();
        StatusText.Text = $"Hostovanie je tvoje. Vo Factoriu otvor presne {World.RelayFileName}.";
        await RenderStateAsync();
    });

    private async Task AcquireAsync()
    {
        var acquired = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/lock/acquire", new { expectedRevision = World.Revision });
        _leaseToken = acquired.GetProperty("lease").GetProperty("token").GetString();
        _hostStartHash = File.Exists(RelayPath) ? await LocalHashAsync(RelayPath) : null;
        _factorioSeen = false;
        _heartbeat.Start();
        StartMonitoring(RelayPath);
    }

    private void StartMonitoring(string file)
    {
        StopMonitoring();
        var info = new FileInfo(file);
        _localFingerprint = null;
        _autoUploadPending = false;
        _nextAutoAttempt = DateTime.UtcNow;
        _saveWatcher = new FileSystemWatcher(info.DirectoryName!, info.Name)
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName | NotifyFilters.CreationTime,
            EnableRaisingEvents = true,
        };
        _saveWatcher.Changed += (_, _) => _autoUploadPending = true;
        _saveWatcher.Created += (_, _) => _autoUploadPending = true;
        _saveWatcher.Renamed += (_, _) => _autoUploadPending = true;
        _saveWatcher.Error += (_, _) => _autoUploadPending = true;
        _savePoll.Start();
    }

    private void StopMonitoring()
    {
        _savePoll.Stop();
        _saveWatcher?.Dispose();
        _saveWatcher = null;
        _autoUploadPending = false;
    }

    private async void SavePollTick(object? sender, EventArgs e)
    {
        if (_leaseToken is null || _busy) return;
        if (SafeSaveFiles.FactorioRunning())
        {
            _factorioSeen = true;
            StateText.Text = "HOSTUJEŠ · Factorio beží · save nemením";
            return;
        }
        if (!_autoUploadPending || DateTime.UtcNow < _nextAutoAttempt) return;
        _nextAutoAttempt = DateTime.UtcNow.AddSeconds(15);
        await Run(async () =>
        {
            StatusText.Text = "Overujem nové uloženie…";
            if (await UploadSelectedAsync()) _autoUploadPending = false;
            await RefreshStateAsync();
        });
    }

    private async Task<bool> UploadSelectedAsync(bool freshlyCreated = false)
    {
        var snapshot = freshlyCreated
            ? await SafeSaveFiles.SnapshotVerifiedAsync(RelayPath)
            : await SafeSaveFiles.SnapshotStableAsync(RelayPath);
        if (snapshot is null) return false;
        try
        {
            var sha = await SafeSaveFiles.Sha256Async(snapshot);
            if (_cloudHash is not null && string.Equals(sha, _cloudHash, StringComparison.OrdinalIgnoreCase)) return true;
            StatusText.Text = "Nahrávam nové uloženie…";
            var begin = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/uploads/begin",
                new { baseRevision = World.Revision, lockToken = Lease, sha256 = sha, fileSize = new FileInfo(snapshot).Length });
            var upload = begin.GetProperty("upload");
            await Api.PutZipAsync(upload.GetProperty("contentPath").GetString()!, Lease, snapshot);
            var finalized = await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/uploads/finalize",
                new { uploadId = upload.GetProperty("id").GetString(), lockToken = Lease });
            _cloudHash = sha;
            _world = World with { Revision = finalized.GetProperty("revision").GetProperty("revision").GetInt64() };
            StatusText.Text = $"Nové uloženie je v cloude ako revízia #{World.Revision}.";
            return true;
        }
        finally { if (File.Exists(snapshot)) File.Delete(snapshot); }
    }

    private async void ReleaseClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        if (SafeSaveFiles.FactorioRunning()) throw new InvalidOperationException("Najprv ulož svet a zavri Factorio.");
        var currentHash = await LocalHashAsync(RelayPath);
        if (_factorioSeen && string.Equals(currentHash, _hostStartHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Factorio bežalo, ale relay save sa nezmenil. Ulož svet pred odovzdaním.");
        if (!await UploadSelectedAsync()) throw new InvalidOperationException("Save sa ešte mení. Počkaj niekoľko sekúnd.");
        await ReleaseLeaseAsync();
        await RefreshStateAsync();
        StatusText.Text = "Save je overený, nahraný a hostovanie bolo odovzdané.";
    });

    private async Task ReleaseLeaseAsync()
    {
        await Api.JsonAsync(HttpMethod.Post, Root(World.Id) + "/lock/release", new { lockToken = Lease });
        _leaseToken = null;
        _heartbeat.Stop();
        StopMonitoring();
        _hostStartHash = null;
        _factorioSeen = false;
    }

    private async void HeartbeatTick(object? sender, EventArgs e)
    {
        if (_leaseToken is null || _api is null || _world is null) return;
        try { await _api.JsonAsync(HttpMethod.Post, Root(_world.Id) + "/lock/renew", new { lockToken = _leaseToken }); }
        catch
        {
            _leaseToken = null; _heartbeat.Stop(); StopMonitoring();
            StatusText.Text = "Hostovanie sa stratilo. Nehraj ďalej; obnov stav a najprv synchronizuj.";
            await Run(RefreshStateAsync);
        }
    }

    private async void StatePollTick(object? sender, EventArgs e)
    {
        if (_api is null || _busy || _leaseToken is not null) return;
        await Run(RefreshStateAsync);
    }

    private async void RefreshClick(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        await RefreshStateAsync();
        StatusText.Text = "Stav je aktuálny.";
    });

    private void SignOutClick(object sender, RoutedEventArgs e)
    {
        if (_leaseToken is not null) { StatusText.Text = "Najprv odovzdaj hostovanie."; return; }
        if (_profile is not null) CredentialStore.Delete(ServiceAddress, _profile);
        _statePoll.Stop(); _api?.Dispose(); _api = null; _world = null; _deviceId = null; _profile = null;
        DashboardPanel.Visibility = Visibility.Collapsed; LoginPanel.Visibility = Visibility.Visible;
        StatusText.Text = "Tento PC bol odpojený. Účet a svet na webe zostali zachované.";
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_leaseToken is not null)
        {
            MessageBox.Show("Najprv ulož svet, zavri Factorio a použi Uložiť a odovzdať.",
                "Hostovanie je stále aktívne", MessageBoxButton.OK, MessageBoxImage.Warning);
            e.Cancel = true;
            return;
        }
        base.OnClosing(e);
    }

    protected override void OnClosed(EventArgs e)
    {
        _heartbeat.Stop(); _statePoll.Stop(); StopMonitoring(); _api?.Dispose();
        base.OnClosed(e);
    }
}
