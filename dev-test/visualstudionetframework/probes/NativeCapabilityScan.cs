using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Thcad.Probes
{
    public sealed class NativeModuleScan
    {
        public string RelativePath;
        public string Category;
        public long Bytes;
        public string Version;
        public string Sha256;
        public string ExportingModuleName;
        public string Machine;
        public bool? Pe32Plus;
        public string ReadError;
        public IList<PeExport> Exports;
    }

    public static class NativeCapabilityScan
    {
        static readonly string[] HostNames =
        {
            "thcad.exe",
            "brx23.dll",
            "bricscadapi.dll",
            "commands.dll",
            "commandsregistry.dll",
            "lispex.dll",
            "axbricscadapp1.dll",
            "axbricscaddb1.dll",
            "axbricscadsm.dll"
        };

        public static void WriteInventoryScan(
            string mechanicalRoot,
            string scanPath,
            string inventoryId,
            string observedHostId)
        {
            if (string.IsNullOrWhiteSpace(mechanicalRoot) || !Directory.Exists(mechanicalRoot))
            {
                throw new DirectoryNotFoundException("THCAD mechanical root not found: " + mechanicalRoot);
            }

            string root = Path.GetFullPath(mechanicalRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string thcadDirectory = Path.Combine(root, "THCAD");
            var files = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (string path in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
            {
                string extension = Path.GetExtension(path);
                if (extension.Equals(".arx", StringComparison.OrdinalIgnoreCase) ||
                    extension.Equals(".brx", StringComparison.OrdinalIgnoreCase))
                {
                    files[path] = Classify(path);
                }
            }

            foreach (string name in HostNames)
            {
                string path = Path.Combine(thcadDirectory, name);
                if (!File.Exists(path))
                {
                    throw new FileNotFoundException("Host binary not found: " + path);
                }
                files[path] = "host_runtime";
            }

            var modules = new List<NativeModuleScan>();
            foreach (KeyValuePair<string, string> pair in files)
            {
                modules.Add(ScanFile(root, pair.Key, pair.Value));
            }
            modules.Sort((left, right) => string.Compare(left.RelativePath, right.RelativePath, StringComparison.OrdinalIgnoreCase));

            int sdkHeaders = 0;
            int libFiles = 0;
            int coffImportLibs = 0;
            foreach (string path in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
            {
                string extension = Path.GetExtension(path);
                if (extension.Equals(".h", StringComparison.OrdinalIgnoreCase) ||
                    extension.Equals(".hpp", StringComparison.OrdinalIgnoreCase) ||
                    extension.Equals(".idl", StringComparison.OrdinalIgnoreCase))
                {
                    sdkHeaders++;
                }
                else if (extension.Equals(".lib", StringComparison.OrdinalIgnoreCase))
                {
                    libFiles++;
                    if (IsCoffArchive(path))
                    {
                        coffImportLibs++;
                    }
                }
            }

            var json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "inventory_id");
            WriteString(json, inventoryId);
            json.Append(',');
            WriteKey(json, "observed_host_id");
            WriteString(json, observedHostId);
            json.Append(',');
            WriteKey(json, "sdk_headers");
            json.Append(sdkHeaders.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "lib_files");
            json.Append(libFiles.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "coff_import_libs");
            json.Append(coffImportLibs.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "modules");
            json.Append('[');
            for (int index = 0; index < modules.Count; index++)
            {
                if (index > 0)
                {
                    json.Append(',');
                }
                WriteModule(json, modules[index]);
            }
            json.Append(']');
            json.Append('}');

            string directory = Path.GetDirectoryName(scanPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }
            File.WriteAllText(scanPath, json.ToString() + "\n", new UTF8Encoding(false));
        }

        public static void WriteInventoryScanFromFiles(
            string root,
            string[] filePaths,
            string scanPath,
            string inventoryId,
            string observedHostId)
        {
            WriteInventoryScanFromFiles(root, filePaths, scanPath, inventoryId, observedHostId, 0, 0, 0);
        }

        public static void WriteInventoryScanFromFiles(
            string root,
            string[] filePaths,
            string scanPath,
            string inventoryId,
            string observedHostId,
            int sdkHeaders,
            int libFiles,
            int coffImportLibs)
        {
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            {
                throw new DirectoryNotFoundException("Product root not found: " + root);
            }
            if (filePaths == null || filePaths.Length == 0)
            {
                throw new ArgumentException("Native module list is empty.", "filePaths");
            }
            if (string.IsNullOrWhiteSpace(inventoryId) || inventoryId.IndexOf("thcad-v24", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                throw new InvalidOperationException("AutoCAD native scan refused THCAD inventory id: " + inventoryId);
            }
            if (string.IsNullOrWhiteSpace(observedHostId) || !observedHostId.Equals("autocad-2024", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("AutoCAD native scan requires observed_host_id=autocad-2024.");
            }

            string resolvedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var files = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index < filePaths.Length; index++)
            {
                string path = filePaths[index];
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    throw new FileNotFoundException("Native module not found: " + path);
                }
                string full = Path.GetFullPath(path);
                string lowered = full.ToLowerInvariant();
                if (lowered.IndexOf("thcad", StringComparison.Ordinal) >= 0 ||
                    lowered.IndexOf("thsoft", StringComparison.Ordinal) >= 0 ||
                    lowered.IndexOf("bricscad", StringComparison.Ordinal) >= 0)
                {
                    throw new InvalidOperationException("Native module path is not in the AutoCAD whitelist: " + full);
                }
                files[full] = ClassifyProduct(full);
            }

            var modules = new List<NativeModuleScan>();
            foreach (KeyValuePair<string, string> pair in files)
            {
                modules.Add(ScanFile(resolvedRoot, pair.Key, pair.Value));
            }
            modules.Sort((left, right) => string.Compare(left.RelativePath, right.RelativePath, StringComparison.OrdinalIgnoreCase));

            var json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "inventory_id");
            WriteString(json, inventoryId);
            json.Append(',');
            WriteKey(json, "observed_host_id");
            WriteString(json, observedHostId);
            json.Append(',');
            WriteKey(json, "sdk_headers");
            json.Append(sdkHeaders.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "lib_files");
            json.Append(libFiles.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "coff_import_libs");
            json.Append(coffImportLibs.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "modules");
            json.Append('[');
            for (int index = 0; index < modules.Count; index++)
            {
                if (index > 0)
                {
                    json.Append(',');
                }
                WriteModule(json, modules[index]);
            }
            json.Append(']');
            json.Append('}');

            string directory = Path.GetDirectoryName(scanPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }
            File.WriteAllText(scanPath, json.ToString() + "\n", new UTF8Encoding(false));
        }

        static NativeModuleScan ScanFile(string root, string fullPath, string category)
        {
            var info = new FileInfo(fullPath);
            var row = new NativeModuleScan
            {
                RelativePath = ToRelative(root, fullPath),
                Category = category,
                Bytes = info.Length,
                Version = FileVersion(fullPath),
                Sha256 = FileSha256(fullPath),
                ExportingModuleName = "",
                Machine = "",
                Pe32Plus = null,
                ReadError = null,
                Exports = new List<PeExport>()
            };
            try
            {
                PeExportInventory inventory = PeExportReader.Read(fullPath);
                row.ExportingModuleName = inventory.ExportingModuleName ?? "";
                row.Machine = "0x" + inventory.Machine.ToString("X4", CultureInfo.InvariantCulture);
                row.Pe32Plus = inventory.IsPe32Plus;
                row.Exports = inventory.Exports ?? new List<PeExport>();
            }
            catch (Exception error)
            {
                row.ReadError = error.Message;
            }
            return row;
        }

        static void WriteModule(StringBuilder json, NativeModuleScan module)
        {
            json.Append('{');
            WriteKey(json, "relative_path");
            WriteString(json, module.RelativePath);
            json.Append(',');
            WriteKey(json, "category");
            WriteString(json, module.Category);
            json.Append(',');
            WriteKey(json, "bytes");
            json.Append(module.Bytes.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "version");
            WriteStringOrNull(json, module.Version);
            json.Append(',');
            WriteKey(json, "sha256");
            WriteStringOrNull(json, module.Sha256);
            json.Append(',');
            WriteKey(json, "exporting_module_name");
            WriteString(json, module.ExportingModuleName ?? "");
            json.Append(',');
            WriteKey(json, "machine");
            WriteStringOrNull(json, string.IsNullOrEmpty(module.Machine) ? null : module.Machine);
            json.Append(',');
            WriteKey(json, "pe32_plus");
            if (module.Pe32Plus.HasValue)
            {
                json.Append(module.Pe32Plus.Value ? "true" : "false");
            }
            else
            {
                json.Append("null");
            }
            json.Append(',');
            WriteKey(json, "read_error");
            WriteStringOrNull(json, module.ReadError);
            json.Append(',');
            WriteKey(json, "exports");
            json.Append('[');
            IList<PeExport> exports = module.Exports ?? new List<PeExport>();
            for (int index = 0; index < exports.Count; index++)
            {
                if (index > 0)
                {
                    json.Append(',');
                }
                PeExport export = exports[index];
                json.Append('{');
                WriteKey(json, "name");
                WriteString(json, export.Name ?? "");
                json.Append(',');
                WriteKey(json, "ordinal");
                json.Append(export.Ordinal.ToString(CultureInfo.InvariantCulture));
                json.Append(',');
                WriteKey(json, "rva");
                json.Append('"');
                json.Append("0x");
                json.Append(export.RelativeVirtualAddress.ToString("X8", CultureInfo.InvariantCulture));
                json.Append('"');
                json.Append(',');
                WriteKey(json, "forwarder");
                WriteString(json, export.Forwarder ?? "");
                json.Append('}');
            }
            json.Append(']');
            json.Append('}');
        }

        static string Classify(string path)
        {
            string extension = Path.GetExtension(path);
            if (extension.Equals(".arx", StringComparison.OrdinalIgnoreCase))
            {
                return "mechanical_arx";
            }
            if (extension.Equals(".brx", StringComparison.OrdinalIgnoreCase))
            {
                return "brx_plugin";
            }
            return "host_runtime";
        }

        static string ClassifyProduct(string path)
        {
            string extension = Path.GetExtension(path);
            if (extension.Equals(".arx", StringComparison.OrdinalIgnoreCase))
            {
                return "product_arx";
            }
            if (extension.Equals(".crx", StringComparison.OrdinalIgnoreCase))
            {
                return "product_crx";
            }
            if (extension.Equals(".dbx", StringComparison.OrdinalIgnoreCase))
            {
                return "product_dbx";
            }
            return "host_runtime";
        }

        static string ToRelative(string root, string fullPath)
        {
            string prefix = root + Path.DirectorySeparatorChar;
            string full = Path.GetFullPath(fullPath);
            if (full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return full.Substring(prefix.Length).Replace('\\', '/');
            }
            return Path.GetFileName(full);
        }

        static string FileSha256(string path)
        {
            using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(stream);
                var text = new StringBuilder(hash.Length * 2);
                for (int index = 0; index < hash.Length; index++)
                {
                    text.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return text.ToString();
            }
        }

        static string FileVersion(string path)
        {
            try
            {
                FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
                if (!string.IsNullOrWhiteSpace(info.FileVersion))
                {
                    return info.FileVersion.Trim();
                }
                if (!string.IsNullOrWhiteSpace(info.ProductVersion))
                {
                    return info.ProductVersion.Trim();
                }
            }
            catch
            {
            }
            return null;
        }

        static bool IsCoffArchive(string path)
        {
            try
            {
                using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    byte[] header = new byte[8];
                    int read = stream.Read(header, 0, header.Length);
                    if (read < 8)
                    {
                        return false;
                    }
                    return Encoding.ASCII.GetString(header) == "!<arch>\n";
                }
            }
            catch
            {
                return false;
            }
        }

        static void WriteKey(StringBuilder json, string name)
        {
            WriteString(json, name);
            json.Append(':');
        }

        static void WriteStringOrNull(StringBuilder json, string value)
        {
            if (value == null)
            {
                json.Append("null");
            }
            else
            {
                WriteString(json, value);
            }
        }

        static void WriteString(StringBuilder json, string value)
        {
            json.Append('"');
            if (value != null)
            {
                for (int i = 0; i < value.Length; i++)
                {
                    char c = value[i];
                    switch (c)
                    {
                        case '"':
                            json.Append("\\\"");
                            break;
                        case '\\':
                            json.Append("\\\\");
                            break;
                        case '\b':
                            json.Append("\\b");
                            break;
                        case '\f':
                            json.Append("\\f");
                            break;
                        case '\n':
                            json.Append("\\n");
                            break;
                        case '\r':
                            json.Append("\\r");
                            break;
                        case '\t':
                            json.Append("\\t");
                            break;
                        default:
                            if (c < 0x20)
                            {
                                json.Append("\\u");
                                json.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                            }
                            else
                            {
                                json.Append(c);
                            }
                            break;
                    }
                }
            }
            json.Append('"');
        }
    }
}
