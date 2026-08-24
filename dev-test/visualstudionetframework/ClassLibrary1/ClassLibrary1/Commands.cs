using System;
using System.IO;
using System.Reflection;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Runtime;
using CoreApp = Autodesk.AutoCAD.ApplicationServices.Core.Application;

namespace Shb.AutoCAD.Extractor
{
    public sealed class Commands
    {
        public const string CommandName = "SHBEXTRACT";

        internal static readonly string DefaultOutputRoot =
            @"D:\dev\dsh-engineer\dev-test\visualstudionetframework\out";

        static Commands()
        {
            try
            {
                Directory.CreateDirectory(DefaultOutputRoot);
                File.AppendAllText(
                    Path.Combine(DefaultOutputRoot, "_plugin-loaded.txt"),
                    DateTime.UtcNow.ToString("o") + " commands_static_ctor" + Environment.NewLine);
            }
            catch
            {
            }
        }

        [CommandMethod(CommandName, CommandFlags.Session)]
        public void Extract()
        {
            try
            {
                Database db = HostApplicationServices.WorkingDatabase;
                if (db == null)
                {
                    WriteMessage("\nSHBEXTRACT: no working database.\n");
                    return;
                }

                string outputRoot = ResolveOutputRoot();
                string reportPath = DrawingExtractor.Extract(db, outputRoot);
                WriteMessage("\nSHBEXTRACT done: " + reportPath + "\n");
            }
            catch (System.Exception ex)
            {
                WriteMessage("\nSHBEXTRACT FAILED: " + ex.Message + "\n");
                try
                {
                    string failDir = ResolveOutputRoot();
                    Directory.CreateDirectory(failDir);
                    File.WriteAllText(
                        Path.Combine(failDir, "extract-failed.txt"),
                        DateTime.UtcNow.ToString("o") + "\n" + ex);
                }
                catch
                {
                    // last-resort: keep CAD alive
                }
            }
        }

        [LispFunction("SHBEXTRACTL")]
        public object ExtractLisp(ResultBuffer args)
        {
            Extract();
            return true;
        }

        internal static string ResolveOutputRoot()
        {
            string fromEnv = Environment.GetEnvironmentVariable("SHB_EXTRACT_OUT");
            if (!string.IsNullOrWhiteSpace(fromEnv))
            {
                return Path.GetFullPath(fromEnv.Trim());
            }

            try
            {
                string dllDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string marker = Path.Combine(dllDir ?? "", "output-root.txt");
                if (File.Exists(marker))
                {
                    string line = File.ReadAllText(marker).Trim();
                    if (line.Length > 0)
                    {
                        return Path.GetFullPath(line);
                    }
                }
            }
            catch
            {
                // fall through to default
            }

            return DefaultOutputRoot;
        }

        internal static void WriteMessage(string text)
        {
            try
            {
                var doc = CoreApp.DocumentManager.MdiActiveDocument;
                if (doc != null)
                {
                    doc.Editor.WriteMessage(text);
                }
            }
            catch
            {
                // accoreconsole / no editor: ignore
            }
        }
    }
}
