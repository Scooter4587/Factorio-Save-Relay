# Windows aplikácia

Windows aplikácia je predĺžená ruka účtu a spoločného sveta vytvoreného na webe. Registráciu, obnovu účtu, vytvorenie sveta a pozvánku druhému hráčovi rieši iba web. Aplikácia sa prihlási tým istým menom a heslom, vytvorí zariadenie a jeho token uloží do Windows Credential Managera. Heslo neukladá.

## Bezpečný RELAY save

Prvotné nastavenie robí vlastník sveta na jednom PC:

1. Zavrie Factorio a v aplikácii vyberie existujúci ZIP save.
2. Aplikácia overí ZIP a vytvorí vedľa neho samostatnú kópiu s názvom `<pôvodný názov> RELAY.zip` v `%APPDATA%\Factorio\saves`.
3. Pôvodný ZIP neupraví ani neprepíše. Názov RELAY súboru sa natrvalo uloží k spoločnému svetu.
4. Overenú RELAY kópiu nahrá ako prvú cloudovú revíziu.

Druhý hráč sa prihlási vo svojej aplikácii a stlačí **Synchronizovať**. Dostane ten istý pomenovaný RELAY save do svojho Factorio saves priečinka. Od tej chvíle obaja vo Factoriu otvárajú a ukladajú iba RELAY save.

Pred prepísaním existujúceho RELAY save aplikácia overí veľkosť, SHA-256 a čitateľnosť ZIPu. Predchádzajúcu lokálnu verziu uloží mimo Factorio saves do `%LOCALAPPDATA%\FactorioSaveRelay\backups`. Nikdy automaticky nemení pôvodný save, z ktorého vznikla prvá kópia.

## Bežné hostovanie

Správne poradie je:

1. **Synchronizovať** a počkať na stav `SYNCHRONIZOVANÉ`.
2. **Prevziať hostovanie**. Cloudový lease zabráni druhému PC súčasne publikovať inú históriu.
3. Vo Factoriu otvoriť presne zobrazený `RELAY.zip`, hrať a uložiť.
4. Zavrieť Factorio.
5. **Uložiť a odovzdať**. Aplikácia overí stabilný ZIP, nahrá novú revíziu a až potom uvoľní hostovanie.

Počas hostovania aplikácia lease obnovuje, sleduje zmenu RELAY súboru a po zavretí Factoria vie zmenu nahrať. Odovzdanie odmietne, ak Factorio stále beží, save sa ešte mení alebo sa po hraní vôbec nezmenil. Aplikáciu nemožno zavrieť, kým drží hostovanie.

## Vývoj a build

Klient vyžaduje Windows a .NET 10 SDK:

```powershell
dotnet build client/FactorioSaveRelay.Client/FactorioSaveRelay.Client.csproj -c Release
dotnet run --project client/FactorioSaveRelay.SafetyTests/FactorioSaveRelay.SafetyTests.csproj -c Release
```

S lokálnym Workerom na `http://127.0.0.1:8787` pridaj `--api`; test použije iba syntetické ZIPy a dočasné účty:

```powershell
dotnet run --project client/FactorioSaveRelay.SafetyTests/FactorioSaveRelay.SafetyTests.csproj -c Release -- --api
```

`client/publish-test.ps1` vytvorí samostatný win-x64 ZIP v ignorovanom priečinku `artifacts/`. Živá aplikácia používa súkromný API endpoint a jej ZIP web vydá iba prihlásenému používateľovi. Samotný stiahnutý súbor však možno ďalej skopírovať; bezpečnosť dát stojí na povinnom prihlásení aplikácie, nie na utajení EXE.

Klient zatiaľ očakáva presne jeden spoločný svet na účet a Factorio nespúšťa ani nezatvára. ZIP môže byť technicky platný, ale nekompatibilný s nainštalovanou verziou Factoria alebo modmi; to dokáže potvrdiť až reálny test hry.
