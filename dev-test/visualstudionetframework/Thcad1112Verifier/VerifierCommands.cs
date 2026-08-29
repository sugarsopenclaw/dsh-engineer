using System;
using System.IO;
using Bricscad.ApplicationServices;
using Teigha.DatabaseServices;
using Teigha.Runtime;

[assembly: ExtensionApplication(typeof(Shb.Thcad.Verifier1112.VerifierApplication))]
[assembly: CommandClass(typeof(Shb.Thcad.Verifier1112.VerifierCommands))]

namespace Shb.Thcad.Verifier1112
{
    public sealed class VerifierApplication : IExtensionApplication
    {
        public void Initialize()
        {
            VerifierCommands.WriteMessage(
                "\n11-20 verifier loaded: SHBVERIFY1112ONE / SHBVERIFY1112MEDIUM / "
                + "SHBVERIFY1112LARGE1 / SHBVERIFY1112LARGE2 / SHBVERIFY1112ALL\n");
        }

        public void Terminate()
        {
        }
    }

    public sealed class VerifierCommands
    {
        const string SourceRoot = @"D:\dev\dsh-engineer\client-data\transformer-design-drawings";
        const string OutputRoot = @"D:\dev\dsh-engineer\dev-test\visualstudionetframework\out-thcad-11-12";
        const string SmallestDrawing = "8TBC.312.A110050.101_1.DWG";
        const string MediumDrawing = "5TBC.384.A110050.2_1.DWG";
        const string LargeDrawing1 = "5TBC.709.A110050.1_1.DWG";
        const string LargeDrawing2 = "5TBC.709.A110050.1_2.DWG";

        [CommandMethod("SHBVERIFY1112ONE", CommandFlags.Session)]
        public void VerifyOne()
        {
            Run(new[] { Path.Combine(SourceRoot, SmallestDrawing) }, "one");
        }

        [CommandMethod("SHBVERIFY1112MEDIUM", CommandFlags.Session)]
        public void VerifyMedium()
        {
            Run(new[] { Path.Combine(SourceRoot, MediumDrawing) }, "medium");
        }

        [CommandMethod("SHBVERIFY1112LARGE1", CommandFlags.Session)]
        public void VerifyLarge1()
        {
            Run(new[] { Path.Combine(SourceRoot, LargeDrawing1) }, "large1");
        }

        [CommandMethod("SHBVERIFY1112LARGE2", CommandFlags.Session)]
        public void VerifyLarge2()
        {
            Run(new[] { Path.Combine(SourceRoot, LargeDrawing2) }, "large2");
        }

        [CommandMethod("SHBVERIFY1112ALL", CommandFlags.Session)]
        public void VerifyAll()
        {
            string[] files = Directory.GetFiles(SourceRoot, "*.dwg");
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            Run(files, "all");
        }

        void Run(string[] files, string mode)
        {
            Directory.CreateDirectory(OutputRoot);
            string logPath = Path.Combine(OutputRoot, "_verify-log.txt");
            string donePath = Path.Combine(OutputRoot, "_verify-done.txt");
            Action<string> log = delegate(string value)
            {
                string line = DateTime.UtcNow.ToString("o") + " " + value + Environment.NewLine;
                try { File.AppendAllText(logPath, line); }
                catch { }
            };
            int completed = 0;
            int failed = 0;
            log("start mode=" + mode + " files=" + files.Length);
            foreach (string file in files)
            {
                Database database = null;
                try
                {
                    log("drawing_start " + Path.GetFileName(file));
                    database = new Database(false, true);
                    database.ReadDwgFile(
                        file,
                        FileOpenMode.OpenForReadAndAllShare,
                        false,
                        "");
                    database.CloseInput(true);
                    string report = Shb.Thcad.Extractor.DrawingExtractor.Extract(
                        database,
                        OutputRoot);
                    completed++;
                    log("drawing_done " + Path.GetFileName(file) + " report=" + report);
                }
                catch (System.Exception exception)
                {
                    failed++;
                    log("drawing_fail " + Path.GetFileName(file) + " "
                        + exception.GetType().Name + " " + SafeMessage(exception));
                }
                finally
                {
                    if (database != null) { database.Dispose(); }
                }
            }
            string summary = "done mode=" + mode + " completed=" + completed + " failed=" + failed;
            log(summary);
            File.WriteAllText(donePath, DateTime.UtcNow.ToString("o") + " " + summary + Environment.NewLine);
            WriteMessage("\nSHBVERIFY1112 " + summary + "\n");
        }

        static string SafeMessage(System.Exception exception)
        {
            try { return exception.Message ?? ""; }
            catch { return "<message unavailable>"; }
        }

        internal static void WriteMessage(string value)
        {
            try
            {
                var document = Application.DocumentManager.MdiActiveDocument;
                if (document != null) { document.Editor.WriteMessage(value); }
            }
            catch
            {
            }
        }
    }
}
