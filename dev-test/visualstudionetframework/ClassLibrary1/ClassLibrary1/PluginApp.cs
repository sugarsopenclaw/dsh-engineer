using System;
using System.IO;
using Autodesk.AutoCAD.Runtime;

[assembly: ExtensionApplication(typeof(Shb.AutoCAD.Extractor.PluginApp))]
[assembly: CommandClass(typeof(Shb.AutoCAD.Extractor.Commands))]

namespace Shb.AutoCAD.Extractor
{
    public sealed class PluginApp : IExtensionApplication
    {
        const string Breadcrumb = @"D:\dev\dsh-engineer\dev-test\visualstudionetframework\out\_plugin-loaded.txt";

        static PluginApp()
        {
            WriteBreadcrumb("static_ctor");
        }

        public void Initialize()
        {
            WriteBreadcrumb("initialize");
            try
            {
                Commands.WriteMessage("\nShb.AutoCAD.Extractor loaded. Command: SHBEXTRACT\n");
            }
            catch
            {
                // Loading must not throw: a failed apply/load can take the whole CAD session down.
            }
        }

        static void WriteBreadcrumb(string stage)
        {
            try
            {
                string dir = Path.GetDirectoryName(Breadcrumb);
                if (dir != null)
                {
                    Directory.CreateDirectory(dir);
                }

                File.AppendAllText(
                    Breadcrumb,
                    DateTime.UtcNow.ToString("o") + " " + stage + Environment.NewLine);
            }
            catch
            {
            }
        }

        public void Terminate()
        {
        }
    }
}
