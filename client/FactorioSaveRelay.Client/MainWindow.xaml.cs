using System.IO;
using System.Windows;

namespace FactorioSaveRelay.Client;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        FactorioSavePathText.Text = GetDefaultFactorioSavePath();
    }

    private static string GetDefaultFactorioSavePath()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "Factorio", "saves");
    }
}
