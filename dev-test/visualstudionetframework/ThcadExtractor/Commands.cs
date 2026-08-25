using System;
using System.IO;
using System.Reflection;
using Teigha.DatabaseServices;
using Teigha.Runtime;
using CoreApp = Bricscad.ApplicationServices.Application;

namespace Shb.Thcad.Extractor
{
    public sealed class Commands
    {
        public const string CommandName = "SHBEXTRACT";

        internal static readonly string DefaultOutputRoot =
            @"D:\dev\dsh-engineer\dev-test\visualstudionetframework\out-thcad";

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

        // Batch-extract every DWG in the drop via side databases (no editor open,
        // so the host can never rewrite client-data). Skips drawings that already
        // have an extraction-report.json unless SHB_EXTRACT_FORCE=1.
        // Progress: _batch-log.txt; completion sentinel: _batch-done.txt (both in output root).
        [CommandMethod("SHBEXTRACTALL", CommandFlags.Session)]
        public void ExtractAll()
        {
            string outputRoot;
            try
            {
                outputRoot = ResolveOutputRoot();
                Directory.CreateDirectory(outputRoot);
            }
            catch (System.Exception ex)
            {
                WriteMessage("\nSHBEXTRACTALL: cannot resolve output root: " + ex.Message + "\n");
                return;
            }

            string srcRoot = Environment.GetEnvironmentVariable("SHB_EXTRACT_SRC");
            if (string.IsNullOrWhiteSpace(srcRoot))
            {
                srcRoot = @"D:\dev\dsh-engineer\client-data\transformer-design-drawings";
            }

            string logPath = Path.Combine(outputRoot, "_batch-log.txt");
            Action<string> log = line =>
            {
                try { File.AppendAllText(logPath, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine); }
                catch { }
            };

            try
            {
                if (!Directory.Exists(srcRoot))
                {
                    log("src_missing " + srcRoot);
                    WriteMessage("\nSHBEXTRACTALL: source dir missing: " + srcRoot + "\n");
                    return;
                }

                var files = Directory.GetFiles(srcRoot, "*.dwg");
                Array.Sort(files, StringComparer.OrdinalIgnoreCase);
                log("batch_start files=" + files.Length);

                int done = 0, skipped = 0, failed = 0;
                foreach (var path in files)
                {
                    string stem = Path.GetFileNameWithoutExtension(path);
                    if (File.Exists(Path.Combine(outputRoot, stem, "extraction-report.json"))
                        && Environment.GetEnvironmentVariable("SHB_EXTRACT_FORCE") != "1")
                    {
                        skipped++;
                        log("skip " + stem);
                        continue;
                    }

                    Database db = null;
                    try
                    {
                        log("start " + stem);
                        db = new Database(false, true);
                        db.ReadDwgFile(path, FileOpenMode.OpenForReadAndAllShare, false, "");
                        db.CloseInput(true);
                        string report = DrawingExtractor.Extract(db, outputRoot);
                        done++;
                        log("done " + stem + " -> " + report);
                    }
                    catch (System.Exception ex)
                    {
                        failed++;
                        log("fail " + stem + " " + ex.GetType().Name + " " + ex.Message);
                        WriteMessage("\nSHBEXTRACTALL failed for " + stem + ": " + ex.Message + "\n");
                    }
                    finally
                    {
                        if (db != null)
                        {
                            db.Dispose();
                        }
                    }
                }

                string summary = "batch_end done=" + done + " skipped=" + skipped + " failed=" + failed;
                log(summary);
                File.WriteAllText(
                    Path.Combine(outputRoot, "_batch-done.txt"),
                    DateTime.UtcNow.ToString("o") + " " + summary + Environment.NewLine);
                WriteMessage("\nSHBEXTRACTALL " + summary + "\n");
            }
            catch (System.Exception ex)
            {
                log("batch_abort " + ex);
                WriteMessage("\nSHBEXTRACTALL aborted: " + ex.Message + "\n");
            }
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
