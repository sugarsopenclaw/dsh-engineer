using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;
using Bricscad.ApplicationServices;
using Bricscad.EditorInput;
using Teigha.DatabaseServices;
using Teigha.Geometry;
using Teigha.Runtime;
using CoreApp = Bricscad.ApplicationServices.Application;

[assembly: ExtensionApplication(typeof(Shb.Thcad.AgentBridge.BridgeApplication))]
[assembly: CommandClass(typeof(Shb.Thcad.AgentBridge.BridgeCommands))]

namespace Shb.Thcad.AgentBridge
{
    internal static class BridgeProtocol
    {
        public const int Version = 1;
        public const string ModalCommandName = "SHBTHCADAGENTV4";
        public const string ApplicationCommandName = "SHBTHCADAGENTV4APP";
        public const string DispatchMode = "request_id_prompt_v1";

        static readonly ISet<string> ModalOperations = new HashSet<string>(
            new[] { "status", "extract_current", "locate_handles", "scan_texts" },
            StringComparer.OrdinalIgnoreCase);

        static readonly ISet<string> ApplicationOperations = new HashSet<string>(
            new[]
            {
                "open_document",
                "activate_document",
                "close_document",
                "save_document_as",
                "save_document"
            },
            StringComparer.OrdinalIgnoreCase);

        static readonly IDictionary<int, string> ArtifactFiles = new Dictionary<int, string>
        {
            { 1, "drawing.json" },
            { 2, "drawing-frames.json" },
            { 3, "drawing-zones.json" },
            { 4, "bom-knowledge.json" },
            { 5, "technical-requirements.json" },
            { 6, "layer-analysis.json" },
            { 7, "centerline-identification.json" },
            { 8, "annotation-identification.json" },
            { 9, "dimension-topology.json" },
            { 10, "engineering-line-semantics.json" },
            { 11, "block-instance-coordinate-facts.json" },
            { 12, "planar-topology.json" },
            { 13, "engineering-view-regions.json" },
            { 14, "representation-correspondence.json" },
            { 15, "representation-identity-resolution.json" },
            { 16, "manufacturing-profile-features.json" },
            { 17, "mechanical-interface-adjacency.json" },
            { 18, "dimension-geometry-binding.json" },
            { 19, "semantic-drawing-snapshot.json" },
            { 20, "cross-drawing-observation.json" },
            { 21, "bom-instance-coverage.json" }
        };

        public static IDictionary<int, string> GetArtifactFiles()
        {
            return ArtifactFiles;
        }

        public static bool IsApplicationOperation(string operation)
        {
            return ApplicationOperations.Contains(operation ?? "");
        }

        public static bool ClaimsOperation(string operation, bool applicationContext)
        {
            if (applicationContext)
            {
                return ApplicationOperations.Contains(operation ?? "");
            }
            return ModalOperations.Contains(operation ?? "")
                || (!ApplicationOperations.Contains(operation ?? "")
                    && !string.IsNullOrWhiteSpace(operation));
        }
    }

    public sealed class BridgeApplication : IExtensionApplication
    {
        public void Initialize()
        {
            try
            {
                BridgeCommands.WriteMessage(
                    "\nShenbian THCAD Agent Bridge V4 loaded. Commands: "
                    + BridgeProtocol.ModalCommandName + " / "
                    + BridgeProtocol.ApplicationCommandName + "\n");
                BridgeCommands.WriteLoadedMarker();
            }
            catch
            {
                // A load failure must not destabilize the user's CAD session.
            }
        }

        public void Terminate()
        {
        }
    }

    public sealed class BridgeCommands
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        [CommandMethod(BridgeProtocol.ModalCommandName, CommandFlags.Modal)]
        public void ExecutePendingJobs()
        {
            ExecuteRequestedJob(false);
        }

        [CommandMethod(BridgeProtocol.ApplicationCommandName, CommandFlags.Session)]
        public void ExecutePendingApplicationJobs()
        {
            ExecuteRequestedJob(true);
        }

        static void ExecuteRequestedJob(bool applicationContext)
        {
            string commandName = applicationContext
                ? BridgeProtocol.ApplicationCommandName
                : BridgeProtocol.ModalCommandName;
            string root;
            try
            {
                root = ResolveBridgeRoot();
                EnsureDirectories(root);
            }
            catch (System.Exception ex)
            {
                WriteMessage("\n" + commandName + ": bridge root unavailable: "
                    + ex.Message + "\n");
                return;
            }

            string requestId = PromptRequestId(commandName);
            if (string.IsNullOrWhiteSpace(requestId))
            {
                return;
            }

            try
            {
                ValidateRequestId(requestId);
            }
            catch (System.Exception ex)
            {
                WriteMessage("\n" + commandName + ": " + ex.Message + "\n");
                return;
            }

            string pendingPath = Path.Combine(root, "pending", requestId + ".json");
            if (!File.Exists(pendingPath))
            {
                WriteMessage("\n" + commandName + ": request " + requestId
                    + " is no longer pending.\n");
                return;
            }

            bool completed = TryProcessJob(root, pendingPath, applicationContext);
            WriteMessage("\n" + commandName + ": request " + requestId
                + (completed ? " completed.\n" : " failed to publish a response.\n"));
        }

        static string PromptRequestId(string commandName)
        {
            Document document = CoreApp.DocumentManager.MdiActiveDocument;
            if (document == null)
            {
                WriteMessage("\n" + commandName + ": THCAD has no active document.\n");
                return string.Empty;
            }

            var options = new PromptStringOptions("\n" + commandName + " request id: ");
            options.AllowSpaces = false;
            PromptResult result = document.Editor.GetString(options);
            return result.Status == PromptStatus.OK ? (result.StringResult ?? string.Empty).Trim() : string.Empty;
        }

        static bool TryProcessJob(string root, string pendingPath, bool applicationContext)
        {
            string requestId = Path.GetFileNameWithoutExtension(pendingPath);
            string runningPath = Path.Combine(root, "running", requestId + ".json");
            string completedPath = Path.Combine(root, "completed", requestId + ".json");
            IDictionary<string, object> request = null;
            IDictionary<string, object> response;

            try
            {
                ValidateRequestId(requestId);
                File.Move(pendingPath, runningPath);
                request = Json.DeserializeObject(File.ReadAllText(runningPath))
                    as IDictionary<string, object>;
                string operation = GetString(request, "operation");
                if (!BridgeProtocol.ClaimsOperation(operation, applicationContext))
                {
                    throw new BridgeException(
                        "OPERATION_CONTEXT_MISMATCH",
                        "Operation " + operation + " was dispatched to the wrong THCAD command context.");
                }
                response = ExecuteRequest(root, requestId, request);
            }
            catch (System.Exception ex)
            {
                response = ErrorResponse(
                    requestId,
                    GetString(request, "operation"),
                    StableErrorCode(ex),
                    ex.Message);
            }

            try
            {
                AtomicWrite(
                    Path.Combine(root, "responses", requestId + ".json"),
                    Shb.Thcad.Extractor.JsonUtil.Serialize(response));
            }
            catch (System.Exception ex)
            {
                WriteMessage("\n" + BridgeProtocol.ModalCommandName
                    + ": cannot publish response " + requestId + ": " + ex.Message + "\n");
                return false;
            }

            try
            {
                if (File.Exists(completedPath))
                {
                    File.Delete(completedPath);
                }
                if (File.Exists(runningPath))
                {
                    File.Move(runningPath, completedPath);
                }
            }
            catch
            {
                // The response is authoritative; retaining a running request is diagnostic only.
            }

            return true;
        }

        static IDictionary<string, object> ExecuteRequest(
            string root,
            string requestId,
            IDictionary<string, object> request)
        {
            if (request == null)
            {
                throw new BridgeException("INVALID_REQUEST", "Request must be a JSON object.");
            }

            int version = GetInt(request, "protocol_version", 0);
            if (version != BridgeProtocol.Version)
            {
                throw new BridgeException(
                    "PROTOCOL_MISMATCH",
                    "Expected protocol_version=" + BridgeProtocol.Version
                    + ", got " + version + ".");
            }

            string embeddedId = GetString(request, "request_id");
            if (!string.Equals(embeddedId, requestId, StringComparison.OrdinalIgnoreCase))
            {
                throw new BridgeException("INVALID_REQUEST", "Request id does not match file name.");
            }

            string operation = GetString(request, "operation");
            IDictionary<string, object> parameters = GetDictionary(request, "params");
            Document document = CoreApp.DocumentManager.MdiActiveDocument;

            IDictionary<string, object> data;
            if (string.Equals(operation, "status", StringComparison.OrdinalIgnoreCase))
            {
                data = BuildStatus(root, document);
            }
            else if (string.Equals(operation, "extract_current", StringComparison.OrdinalIgnoreCase))
            {
                RequireActiveDocument(document);
                ValidateExpectedDocument(parameters, document);
                data = ExtractCurrent(root, requestId, document);
            }
            else if (string.Equals(operation, "locate_handles", StringComparison.OrdinalIgnoreCase))
            {
                RequireActiveDocument(document);
                ValidateExpectedDocument(parameters, document);
                data = LocateHandles(document, parameters);
            }
            else if (string.Equals(operation, "scan_texts", StringComparison.OrdinalIgnoreCase))
            {
                data = ScanTexts(root, parameters);
            }
            else if (string.Equals(operation, "open_document", StringComparison.OrdinalIgnoreCase))
            {
                data = OpenDocument(root, parameters);
            }
            else if (string.Equals(operation, "activate_document", StringComparison.OrdinalIgnoreCase))
            {
                data = ActivateDocument(parameters);
            }
            else if (string.Equals(operation, "close_document", StringComparison.OrdinalIgnoreCase))
            {
                data = CloseDocument(parameters);
            }
            else if (string.Equals(operation, "save_document_as", StringComparison.OrdinalIgnoreCase))
            {
                data = SaveDocumentAs(root, parameters);
            }
            else if (string.Equals(operation, "save_document", StringComparison.OrdinalIgnoreCase))
            {
                data = SaveDocument(root, parameters);
            }
            else
            {
                throw new BridgeException("UNSUPPORTED_OPERATION", "Unsupported operation: " + operation);
            }

            return SuccessResponse(requestId, operation, data);
        }

        static IDictionary<string, object> BuildStatus(string root, Document active)
        {
            var documents = new List<object>();
            foreach (Document document in CoreApp.DocumentManager)
            {
                documents.Add(DocumentMap(document, ReferenceEquals(document, active)));
            }

            object currentAnalysis = null;
            string statePath = Path.Combine(root, "state", "current-analysis.json");
            if (File.Exists(statePath))
            {
                try
                {
                    currentAnalysis = Json.DeserializeObject(File.ReadAllText(statePath));
                }
                catch
                {
                    currentAnalysis = null;
                }
            }

            return Map(
                "host", "THCAD",
                "bridge_version", Assembly.GetExecutingAssembly().GetName().Version.ToString(),
                "commands", Map(
                    "modal", BridgeProtocol.ModalCommandName,
                    "application", BridgeProtocol.ApplicationCommandName),
                "dispatch_mode", BridgeProtocol.DispatchMode,
                "active_document", active == null ? null : DocumentMap(active, true),
                "documents", documents,
                "capability_ids", BridgeProtocol.GetArtifactFiles().Keys.ToArray(),
                "workspace_root", ResolveWorkspaceRoot(root),
                "current_analysis", currentAnalysis);
        }

        static void RequireActiveDocument(Document document)
        {
            if (document == null)
            {
                throw new BridgeException("NO_ACTIVE_DOCUMENT", "THCAD has no active document.");
            }
        }

        static IDictionary<string, object> ExtractCurrent(
            string root,
            string requestId,
            Document document)
        {
            string artifactsRoot = Path.Combine(root, "artifacts");
            Directory.CreateDirectory(artifactsRoot);
            int dbmodBefore = GetDbMod();
            string reportPath = Shb.Thcad.Extractor.DrawingExtractor.Extract(
                document.Database,
                artifactsRoot);
            int dbmodAfter = GetDbMod();
            string artifactDirectory = Path.GetDirectoryName(reportPath);

            var artifacts = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (KeyValuePair<int, string> item in BridgeProtocol.GetArtifactFiles())
            {
                string path = Path.Combine(artifactDirectory, item.Value);
                if (File.Exists(path))
                {
                    artifacts[item.Key.ToString(CultureInfo.InvariantCulture)] = RelativeTo(root, path);
                }
            }

            var state = Map(
                "analysis_id", requestId,
                "generated_at_utc", DateTime.UtcNow.ToString("o"),
                "document_name", Path.GetFileName(document.Name),
                "document_path", document.Name,
                "database_filename", document.Database.Filename,
                "dbmod_before", dbmodBefore,
                "dbmod_after", dbmodAfter,
                "source_status", dbmodAfter == 0 ? "saved" : "dirty_current_session",
                "artifact_directory", RelativeTo(root, artifactDirectory),
                "report", RelativeTo(root, reportPath),
                "artifacts", artifacts);
            AtomicWrite(
                Path.Combine(root, "state", "current-analysis.json"),
                Shb.Thcad.Extractor.JsonUtil.Serialize(state));

            return state;
        }

        static IDictionary<string, object> ScanTexts(
            string root,
            IDictionary<string, object> parameters)
        {
            IList values = GetList(parameters, "files");
            if (values == null || values.Count == 0 || values.Count > 128)
            {
                throw new BridgeException(
                    "INVALID_ARGUMENT",
                    "files must contain between 1 and 128 DWG paths.");
            }

            var files = new List<object>();
            var failures = new List<object>();
            foreach (object value in values)
            {
                string sourcePath = "";
                try
                {
                    sourcePath = ValidateReadableDwgPath(
                        root,
                        Convert.ToString(value, CultureInfo.InvariantCulture));
                    Document openDocument = FindDocumentByPath(sourcePath);
                    int openDbmod = openDocument == null ? -1 : GetDocumentDbMod(openDocument);
                    using (var database = new Database(false, true))
                    {
                        database.ReadDwgFile(
                            sourcePath,
                            FileOpenMode.OpenForReadAndAllShare,
                            false,
                            "");
                        database.CloseInput(true);
                        Dictionary<string, object> inventory =
                            Shb.Thcad.TextInventory.TextInventoryExtractor.Extract(
                                database,
                                sourcePath);
                        inventory["open"] = openDocument != null;
                        inventory["open_dirty"] = openDocument != null && openDbmod != 0;
                        inventory["open_dbmod_known"] = openDocument == null || openDbmod >= 0;
                        inventory["open_dbmod"] = openDbmod;
                        inventory["scanned_at_utc"] = DateTime.UtcNow.ToString("o");
                        files.Add(inventory);
                    }
                }
                catch (System.Exception ex)
                {
                    failures.Add(Map(
                        "path", sourcePath.Length == 0
                            ? Convert.ToString(value, CultureInfo.InvariantCulture)
                            : sourcePath,
                        "code", StableErrorCode(ex),
                        "message", SafeMessage(ex.Message)));
                }
            }

            return Map(
                "requested_count", values.Count,
                "completed_count", files.Count,
                "failed_count", failures.Count,
                "files", files,
                "failures", failures,
                "dwg_modified", false);
        }

        static IDictionary<string, object> OpenDocument(
            string root,
            IDictionary<string, object> parameters)
        {
            string sourcePath = ValidateReadableDwgPath(root, GetString(parameters, "path"));
            bool requestedReadOnly = GetBool(parameters, "read_only", true);
            bool forcedReadOnly = IsInside(ResolveClientDataRoot(root), sourcePath);
            bool readOnly = forcedReadOnly || requestedReadOnly;
            Document existing = FindDocumentByPath(sourcePath);
            if (existing != null)
            {
                if (forcedReadOnly && !existing.IsReadOnly)
                {
                    throw new BridgeException(
                        "CLIENT_DOCUMENT_ALREADY_OPEN_WRITABLE",
                        "The client-data drawing is already open writable. Use activate for read-only analysis of the user's existing session, or copy it to the workspace before editing.");
                }
                CoreApp.DocumentManager.MdiActiveDocument = existing;
                return Map(
                    "already_open", true,
                    "requested_read_only", requestedReadOnly,
                    "forced_read_only", forcedReadOnly,
                    "document", DocumentMap(existing, true),
                    "dwg_modified", false);
            }

            Document opened = CoreApp.DocumentManager.Open(sourcePath, readOnly);
            CoreApp.DocumentManager.MdiActiveDocument = opened;
            return Map(
                "already_open", false,
                "requested_read_only", requestedReadOnly,
                "forced_read_only", forcedReadOnly,
                "document", DocumentMap(opened, true),
                "dwg_modified", false);
        }

        static IDictionary<string, object> ActivateDocument(
            IDictionary<string, object> parameters)
        {
            Document previous = CoreApp.DocumentManager.MdiActiveDocument;
            Document target = ResolveDocument(parameters, true);
            CoreApp.DocumentManager.MdiActiveDocument = target;
            return Map(
                "previous_document", previous == null ? null : Path.GetFileName(previous.Name),
                "document", DocumentMap(target, true),
                "dwg_modified", false);
        }

        static IDictionary<string, object> CloseDocument(
            IDictionary<string, object> parameters)
        {
            if (CoreApp.DocumentManager.Count <= 1)
            {
                throw new BridgeException(
                    "LAST_DOCUMENT_CLOSE_REFUSED",
                    "The bridge will not close the final THCAD document.");
            }

            Document target = ResolveDocument(parameters, true);
            int dbmod = GetDocumentDbMod(target);
            bool discardChanges = GetBool(parameters, "discard_changes", false);
            if (dbmod != 0 && !discardChanges)
            {
                throw new BridgeException(
                    "DIRTY_DOCUMENT_REQUIRES_DISCARD",
                    "Document DBMOD=" + dbmod.ToString(CultureInfo.InvariantCulture)
                    + "; pass discard_changes=true to close without saving.");
            }

            string name = Path.GetFileName(target.Name);
            string targetPath = DocumentPath(target);
            target.CloseAndDiscard();
            Document active = CoreApp.DocumentManager.MdiActiveDocument;
            return Map(
                "closed_document", name,
                "closed_path", targetPath,
                "discarded_changes", dbmod != 0,
                "dbmod_before", dbmod,
                "active_document", active == null ? null : DocumentMap(active, true),
                "dwg_modified", false);
        }

        static IDictionary<string, object> SaveDocumentAs(
            string root,
            IDictionary<string, object> parameters)
        {
            Document document = ResolveDocument(parameters, false);
            string targetPath = ValidateWorkspaceDwgPath(
                root,
                GetString(parameters, "target_path"),
                false);
            if (File.Exists(targetPath))
            {
                throw new BridgeException(
                    "TARGET_ALREADY_EXISTS",
                    "Refusing to overwrite an existing workspace drawing.");
            }

            Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
            int dbmodBefore = GetDocumentDbMod(document);
            string sourceDocumentPathBefore = DocumentPath(document);
            string databaseFilenameBefore = document.Database.Filename;
            using (document.LockDocument())
            {
                document.Database.SaveAs(
                    targetPath,
                    false,
                    DwgVersion.Current,
                    document.Database.SecurityParameters);
            }
            string sourceDocumentPathAfter = DocumentPath(document);
            string databaseFilenameAfter = document.Database.Filename;
            return Map(
                "source_document", Path.GetFileName(document.Name),
                "source_document_path_before", sourceDocumentPathBefore,
                "source_document_path_after", sourceDocumentPathAfter,
                "source_document_path_unchanged", string.Equals(
                    sourceDocumentPathBefore,
                    sourceDocumentPathAfter,
                    StringComparison.OrdinalIgnoreCase),
                "database_filename_before", databaseFilenameBefore,
                "database_filename_after", databaseFilenameAfter,
                "database_filename_changed", !string.Equals(
                    databaseFilenameBefore,
                    databaseFilenameAfter,
                    StringComparison.OrdinalIgnoreCase),
                "target_path", targetPath,
                "dbmod_before", dbmodBefore,
                "document", DocumentMap(document, ReferenceEquals(
                    document,
                    CoreApp.DocumentManager.MdiActiveDocument)),
                "saved", true);
        }

        static IDictionary<string, object> SaveDocument(
            string root,
            IDictionary<string, object> parameters)
        {
            Document document = ResolveDocument(parameters, false);
            string documentPath = ValidateWorkspaceDwgPath(
                root,
                DocumentPath(document),
                true);
            int dbmodBefore = GetDocumentDbMod(document);
            using (document.LockDocument())
            {
                object acadDocument = document.AcadDocument;
                acadDocument.GetType().InvokeMember(
                    "Save",
                    BindingFlags.InvokeMethod,
                    null,
                    acadDocument,
                    new object[0],
                    CultureInfo.InvariantCulture);
            }
            return Map(
                "document_path", documentPath,
                "dbmod_before", dbmodBefore,
                "dbmod_after", GetDocumentDbMod(document),
                "saved", true);
        }

        static IDictionary<string, object> LocateHandles(
            Document document,
            IDictionary<string, object> parameters)
        {
            IList values = GetList(parameters, "handles");
            if (values == null || values.Count == 0 || values.Count > 50)
            {
                throw new BridgeException(
                    "INVALID_ARGUMENT",
                    "handles must contain between 1 and 50 hexadecimal handles.");
            }

            bool zoom = GetBool(parameters, "zoom", true);
            var objectIds = new List<ObjectId>();
            var found = new List<string>();
            var missing = new List<string>();
            Extents3d? combined = null;

            using (Transaction transaction = document.Database.TransactionManager.StartOpenCloseTransaction())
            {
                foreach (object value in values)
                {
                    string normalized = NormalizeHandle(Convert.ToString(value, CultureInfo.InvariantCulture));
                    try
                    {
                        long number = long.Parse(normalized, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
                        ObjectId id = document.Database.GetObjectId(false, new Handle(number), 0);
                        Entity entity = transaction.GetObject(id, OpenMode.ForRead, false) as Entity;
                        if (entity == null)
                        {
                            missing.Add(normalized);
                            continue;
                        }

                        objectIds.Add(id);
                        found.Add(normalized);
                        try
                        {
                            Extents3d extents = entity.GeometricExtents;
                            if (combined.HasValue)
                            {
                                Extents3d aggregate = combined.Value;
                                aggregate.AddExtents(extents);
                                combined = aggregate;
                            }
                            else
                            {
                                combined = extents;
                            }
                        }
                        catch
                        {
                            // Selection can still succeed for entities without extents.
                        }
                    }
                    catch
                    {
                        missing.Add(normalized);
                    }
                }
            }

            if (objectIds.Count > 0)
            {
                document.Editor.SetImpliedSelection(objectIds.ToArray());
            }

            bool viewChanged = false;
            if (zoom && combined.HasValue)
            {
                ZoomTo(document.Editor, combined.Value);
                viewChanged = true;
            }

            return Map(
                "document_name", Path.GetFileName(document.Name),
                "found_handles", found,
                "missing_handles", missing,
                "selection_changed", objectIds.Count > 0,
                "view_changed", viewChanged,
                "bounds", combined.HasValue ? Bounds(combined.Value) : null,
                "dwg_modified", false);
        }

        static void ZoomTo(Editor editor, Extents3d extents)
        {
            double minX = extents.MinPoint.X;
            double minY = extents.MinPoint.Y;
            double maxX = extents.MaxPoint.X;
            double maxY = extents.MaxPoint.Y;
            double width = Math.Max(maxX - minX, 1.0);
            double height = Math.Max(maxY - minY, 1.0);

            using (ViewTableRecord view = editor.GetCurrentView())
            {
                double aspect = view.Height > 1e-9 ? view.Width / view.Height : 1.0;
                if (width / height > aspect)
                {
                    height = width / Math.Max(aspect, 1e-9);
                }
                else
                {
                    width = height * Math.Max(aspect, 1e-9);
                }

                view.CenterPoint = new Point2d((minX + maxX) / 2.0, (minY + maxY) / 2.0);
                view.Width = width * 1.25;
                view.Height = height * 1.25;
                editor.SetCurrentView(view);
            }
        }

        static Document ResolveDocument(
            IDictionary<string, object> parameters,
            bool requireSelector)
        {
            string requestedPath = GetString(parameters, "path");
            string requestedName = GetString(parameters, "name");
            if (string.IsNullOrWhiteSpace(requestedPath)
                && string.IsNullOrWhiteSpace(requestedName))
            {
                if (requireSelector)
                {
                    throw new BridgeException(
                        "INVALID_ARGUMENT",
                        "Provide document name or path.");
                }
                Document active = CoreApp.DocumentManager.MdiActiveDocument;
                RequireActiveDocument(active);
                return active;
            }

            string normalizedPath = string.IsNullOrWhiteSpace(requestedPath)
                ? ""
                : Path.GetFullPath(requestedPath.Trim());
            var matches = new List<Document>();
            foreach (Document document in CoreApp.DocumentManager)
            {
                bool pathMatches = normalizedPath.Length > 0
                    && string.Equals(
                        normalizedPath,
                        DocumentPath(document),
                        StringComparison.OrdinalIgnoreCase);
                bool nameMatches = requestedName.Length > 0
                    && (string.Equals(
                            requestedName,
                            Path.GetFileName(document.Name),
                            StringComparison.OrdinalIgnoreCase)
                        || string.Equals(
                            requestedName,
                            document.Name,
                            StringComparison.OrdinalIgnoreCase));
                if (pathMatches || nameMatches)
                {
                    matches.Add(document);
                }
            }

            if (matches.Count == 0)
            {
                throw new BridgeException("DOCUMENT_NOT_OPEN", "No open document matches the selector.");
            }
            if (matches.Count > 1)
            {
                throw new BridgeException(
                    "AMBIGUOUS_DOCUMENT",
                    "More than one open document matches; use an absolute path.");
            }
            return matches[0];
        }

        static Document FindDocumentByPath(string path)
        {
            string expected = Path.GetFullPath(path);
            foreach (Document document in CoreApp.DocumentManager)
            {
                if (string.Equals(
                    expected,
                    DocumentPath(document),
                    StringComparison.OrdinalIgnoreCase))
                {
                    return document;
                }
            }
            return null;
        }

        static string DocumentPath(Document document)
        {
            if (document == null)
            {
                return "";
            }
            string value = document.Name;
            if (string.IsNullOrWhiteSpace(value) && document.Database != null)
            {
                value = document.Database.Filename;
            }
            try
            {
                return Path.GetFullPath(value);
            }
            catch
            {
                return value ?? "";
            }
        }

        static string ValidateReadableDwgPath(string root, string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new BridgeException("INVALID_ARGUMENT", "DWG path is required.");
            }
            string path = Path.GetFullPath(value.Trim());
            if (!string.Equals(Path.GetExtension(path), ".dwg", StringComparison.OrdinalIgnoreCase))
            {
                throw new BridgeException("INVALID_ARGUMENT", "Only .dwg files are supported.");
            }
            if (!IsInside(ResolveClientDataRoot(root), path)
                && !IsInside(ResolveWorkspaceRoot(root), path))
            {
                throw new BridgeException(
                    "PATH_OUTSIDE_ALLOWED_ROOTS",
                    "Drawing must be under client-data or the THCAD workspace.");
            }
            if (!File.Exists(path))
            {
                throw new BridgeException("DRAWING_NOT_FOUND", "DWG file does not exist.");
            }
            return path;
        }

        static string ValidateWorkspaceDwgPath(
            string root,
            string value,
            bool requireExisting)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new BridgeException("INVALID_ARGUMENT", "Workspace target path is required.");
            }
            string path = Path.GetFullPath(value.Trim());
            if (!string.Equals(Path.GetExtension(path), ".dwg", StringComparison.OrdinalIgnoreCase))
            {
                throw new BridgeException("INVALID_ARGUMENT", "Workspace target must be a .dwg file.");
            }
            if (!IsInside(ResolveWorkspaceRoot(root), path))
            {
                throw new BridgeException(
                    "WRITE_OUTSIDE_WORKSPACE_REFUSED",
                    "DWG writes are only allowed under the THCAD workspace.");
            }
            if (requireExisting && !File.Exists(path))
            {
                throw new BridgeException("DRAWING_NOT_FOUND", "Workspace drawing does not exist.");
            }
            return path;
        }

        static string ResolveProjectRoot(string root)
        {
            return Path.GetFullPath(Path.Combine(root, "..", "..", ".."));
        }

        static string ResolveClientDataRoot(string root)
        {
            return Path.Combine(ResolveProjectRoot(root), "client-data");
        }

        static string ResolveWorkspaceRoot(string root)
        {
            return Path.GetFullPath(Path.Combine(root, "..", "thcad-workspace"));
        }

        static bool IsInside(string root, string candidate)
        {
            string normalizedRoot = Path.GetFullPath(root)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string normalizedCandidate = Path.GetFullPath(candidate)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (string.Equals(normalizedRoot, normalizedCandidate, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            return normalizedCandidate.StartsWith(
                normalizedRoot + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase);
        }

        static IDictionary<string, object> DocumentMap(Document document, bool active)
        {
            return Map(
                "name", Path.GetFileName(document.Name),
                "path", DocumentPath(document),
                "database_filename", document.Database == null ? null : document.Database.Filename,
                "active", active,
                "read_only", document.IsReadOnly,
                "dbmod", GetDocumentDbMod(document),
                "command_in_progress", document.CommandInProgress);
        }

        static void ValidateExpectedDocument(
            IDictionary<string, object> parameters,
            Document document)
        {
            string expected = GetString(parameters, "expected_document");
            if (string.IsNullOrWhiteSpace(expected))
            {
                return;
            }

            string fileName = Path.GetFileName(document.Name);
            if (!string.Equals(expected, fileName, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(expected, document.Name, StringComparison.OrdinalIgnoreCase))
            {
                throw new BridgeException(
                    "DOCUMENT_CHANGED",
                    "Active document is " + fileName + ", expected " + Path.GetFileName(expected) + ".");
            }
        }

        static int GetDbMod()
        {
            try
            {
                object value = CoreApp.GetSystemVariable("DBMOD");
                return Convert.ToInt32(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                return -1;
            }
        }

        static int GetDocumentDbMod(Document document)
        {
            if (document == null)
            {
                return -1;
            }
            if (ReferenceEquals(document, CoreApp.DocumentManager.MdiActiveDocument))
            {
                return GetDbMod();
            }
            try
            {
                object acadDocument = document.AcadDocument;
                object value = acadDocument.GetType().InvokeMember(
                    "GetVariable",
                    BindingFlags.InvokeMethod,
                    null,
                    acadDocument,
                    new object[] { "DBMOD" },
                    CultureInfo.InvariantCulture);
                return Convert.ToInt32(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                return -1;
            }
        }

        static object[] Bounds(Extents3d extents)
        {
            return new object[]
            {
                extents.MinPoint.X,
                extents.MinPoint.Y,
                extents.MaxPoint.X,
                extents.MaxPoint.Y
            };
        }

        static string NormalizeHandle(string value)
        {
            string normalized = (value ?? string.Empty).Trim();
            if (normalized.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized.Substring(2);
            }
            if (normalized.Length == 0 || normalized.Length > 16
                || normalized.Any(c => !Uri.IsHexDigit(c)))
            {
                throw new FormatException("Invalid hexadecimal handle.");
            }
            return normalized.ToUpperInvariant();
        }

        static IDictionary<string, object> SuccessResponse(
            string requestId,
            string operation,
            IDictionary<string, object> data)
        {
            return Map(
                "protocol_version", BridgeProtocol.Version,
                "request_id", requestId,
                "operation", operation,
                "ok", true,
                "completed_at_utc", DateTime.UtcNow.ToString("o"),
                "data", data);
        }

        static IDictionary<string, object> ErrorResponse(
            string requestId,
            string operation,
            string code,
            string message)
        {
            return Map(
                "protocol_version", BridgeProtocol.Version,
                "request_id", requestId,
                "operation", operation,
                "ok", false,
                "completed_at_utc", DateTime.UtcNow.ToString("o"),
                "error", Map("code", code, "message", SafeMessage(message)));
        }

        static string StableErrorCode(System.Exception exception)
        {
            var bridge = exception as BridgeException;
            if (bridge != null)
            {
                return bridge.Code;
            }
            if (exception is IOException)
            {
                return "IO_ERROR";
            }
            return "INTERNAL_ERROR";
        }

        static string SafeMessage(string value)
        {
            string text = string.IsNullOrWhiteSpace(value) ? "Unknown bridge failure." : value.Trim();
            return text.Length <= 1000 ? text : text.Substring(0, 1000);
        }

        static void ValidateRequestId(string requestId)
        {
            if (string.IsNullOrWhiteSpace(requestId) || requestId.Length > 80
                || requestId.Any(c => !(char.IsLetterOrDigit(c) || c == '-')))
            {
                throw new BridgeException("INVALID_REQUEST", "Invalid request id.");
            }
        }

        internal static string ResolveBridgeRoot()
        {
            string fromEnvironment = Environment.GetEnvironmentVariable("SHB_THCAD_BRIDGE_ROOT");
            if (!string.IsNullOrWhiteSpace(fromEnvironment))
            {
                return Path.GetFullPath(fromEnvironment.Trim());
            }

            string assemblyDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string marker = Path.Combine(assemblyDirectory ?? string.Empty, "bridge-root.txt");
            if (!File.Exists(marker))
            {
                throw new InvalidOperationException("bridge-root.txt is missing next to the AgentBridge DLL.");
            }

            string root = File.ReadAllText(marker).Trim();
            if (root.Length == 0)
            {
                throw new InvalidOperationException("bridge-root.txt is empty.");
            }
            return Path.GetFullPath(root);
        }

        static void EnsureDirectories(string root)
        {
            Directory.CreateDirectory(root);
            foreach (string name in new[] { "pending", "running", "completed", "responses", "state", "artifacts" })
            {
                Directory.CreateDirectory(Path.Combine(root, name));
            }
        }

        internal static void WriteLoadedMarker()
        {
            try
            {
                string root = ResolveBridgeRoot();
                EnsureDirectories(root);
                AtomicWrite(
                    Path.Combine(root, "state", "bridge-loaded.json"),
                    Shb.Thcad.Extractor.JsonUtil.Serialize(Map(
                        "loaded_at_utc", DateTime.UtcNow.ToString("o"),
                        "assembly", Assembly.GetExecutingAssembly().Location,
                        "version", Assembly.GetExecutingAssembly().GetName().Version.ToString(),
                        "commands", Map(
                            "modal", BridgeProtocol.ModalCommandName,
                            "application", BridgeProtocol.ApplicationCommandName),
                        "dispatch_mode", BridgeProtocol.DispatchMode)));
            }
            catch
            {
            }
        }

        static string RelativeTo(string root, string path)
        {
            string rootWithSeparator = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            Uri rootUri = new Uri(rootWithSeparator);
            Uri pathUri = new Uri(Path.GetFullPath(path));
            return Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString())
                .Replace('/', Path.DirectorySeparatorChar);
        }

        static void AtomicWrite(string path, string content)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
            File.WriteAllText(temporary, content + Environment.NewLine);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
            File.Move(temporary, path);
        }

        static IDictionary<string, object> Map(params object[] values)
        {
            var map = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i + 1 < values.Length; i += 2)
            {
                map[Convert.ToString(values[i], CultureInfo.InvariantCulture)] = values[i + 1];
            }
            return map;
        }

        static IDictionary<string, object> GetDictionary(
            IDictionary<string, object> map,
            string key)
        {
            if (map == null || !map.ContainsKey(key) || map[key] == null)
            {
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            }
            return map[key] as IDictionary<string, object>
                ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        static IList GetList(IDictionary<string, object> map, string key)
        {
            if (map == null || !map.ContainsKey(key))
            {
                return null;
            }
            return map[key] as IList;
        }

        static string GetString(IDictionary<string, object> map, string key)
        {
            if (map == null || !map.ContainsKey(key) || map[key] == null)
            {
                return string.Empty;
            }
            return Convert.ToString(map[key], CultureInfo.InvariantCulture) ?? string.Empty;
        }

        static int GetInt(IDictionary<string, object> map, string key, int fallback)
        {
            if (map == null || !map.ContainsKey(key) || map[key] == null)
            {
                return fallback;
            }
            try
            {
                return Convert.ToInt32(map[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        static bool GetBool(IDictionary<string, object> map, string key, bool fallback)
        {
            if (map == null || !map.ContainsKey(key) || map[key] == null)
            {
                return fallback;
            }
            try
            {
                return Convert.ToBoolean(map[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        internal static void WriteMessage(string value)
        {
            try
            {
                Document document = CoreApp.DocumentManager.MdiActiveDocument;
                if (document != null)
                {
                    document.Editor.WriteMessage(value);
                }
            }
            catch
            {
            }
        }
    }

    internal sealed class BridgeException : System.Exception
    {
        public BridgeException(string code, string message)
            : base(message)
        {
            Code = code;
        }

        public string Code { get; private set; }
    }
}
