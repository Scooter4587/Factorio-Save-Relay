# Windows client

The desktop client will be responsible for the explicit `Host` and `Join`
workflows, local save discovery, safe file replacement, ZIP validation, SHA-256
verification and host-lease heartbeats.

The first shell targets .NET 10 WPF. It currently displays the default Factorio
save directory and intentionally keeps cloud actions disabled until the backend
identity contract exists.
