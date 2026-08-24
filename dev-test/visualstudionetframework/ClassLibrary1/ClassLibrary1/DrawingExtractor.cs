using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using CoreApp = Autodesk.AutoCAD.ApplicationServices.Core.Application;
using AcException = Autodesk.AutoCAD.Runtime.Exception;

namespace Shb.AutoCAD.Extractor
{
    internal static class DrawingExtractor
    {
        const int MaxPolylineVertices = 20000;
        const int MaxSplinePoints = 8000;
        const int MaxDictionaryDepth = 8;
        const string SchemaVersion = "1";
        const string SourceTag = "autocad2024_dotnet";

        public static string Extract(Database db, string outputRoot)
        {
            if (db == null)
            {
                throw new ArgumentNullException("db");
            }

            string sourcePath = db.Filename ?? "";
            string drawingId = SafeStem(string.IsNullOrWhiteSpace(sourcePath) ? "unnamed" : sourcePath);
            string outDir = Path.Combine(outputRoot, drawingId);
            Directory.CreateDirectory(outDir);

            var startedAt = DateTime.UtcNow;
            var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var layerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var ownerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var decodeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            int entityCount = 0;
            int proxyCount = 0;
            int failedCount = 0;

            string entitiesPath = Path.Combine(outDir, "entities.jsonl");
            string proxiesPath = Path.Combine(outDir, "proxies.jsonl");
            string dictPath = Path.Combine(outDir, "dictionaries.jsonl");
            string errorsPath = Path.Combine(outDir, "errors.jsonl");

            Dictionary<string, object> tables;
            List<Dictionary<string, object>> blockInventory;

            using (var entities = NewWriter(entitiesPath))
            using (var proxies = NewWriter(proxiesPath))
            using (var dictionaries = NewWriter(dictPath))
            using (var errors = NewWriter(errorsPath))
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                tables = DumpTables(db, tr, out blockInventory);

                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                foreach (ObjectId btrId in bt)
                {
                    BlockTableRecord btr = (BlockTableRecord)tr.GetObject(btrId, OpenMode.ForRead);
                    string ownerScope = OwnerScope(btr);
                    foreach (ObjectId entId in btr)
                    {
                        entityCount++;
                        Entity ent = null;
                        try
                        {
                            ent = tr.GetObject(entId, OpenMode.ForRead, false) as Entity;
                            if (ent == null)
                            {
                                failedCount++;
                                WriteLine(errors, Map(
                                    "handle", HandleOf(entId),
                                    "owner_block_name", btr.Name,
                                    "error", "not_an_entity"));
                                continue;
                            }

                            Dictionary<string, object> record = SerializeEntity(ent, btr, ownerScope, tr);
                            string runtime = Convert.ToString(record["runtime_class"]) ?? "unknown";
                            string layer = Convert.ToString(record["layer"]) ?? "";
                            string decode = Convert.ToString(record["decode_status"]) ?? "full";
                            Bump(typeCounts, runtime);
                            Bump(layerCounts, layer.Length == 0 ? "(empty)" : layer);
                            Bump(ownerCounts, ownerScope);
                            Bump(decodeCounts, decode);

                            WriteLine(entities, record);
                            if (decode == "proxy")
                            {
                                proxyCount++;
                                WriteLine(proxies, record);
                            }
                        }
                        catch (System.Exception ex)
                        {
                            failedCount++;
                            WriteLine(errors, Map(
                                "handle", HandleOf(entId),
                                "owner_block_name", btr.Name,
                                "error_type", ex.GetType().Name,
                                "error", Clip(ex.Message, 2048)));
                        }
                    }
                }

                DumpNamedObjects(db, tr, dictionaries);
                tr.Commit();
            }

            var drawing = Map(
                "schema_version", SchemaVersion,
                "drawing_id", drawingId,
                "source_path", sourcePath,
                "filename", string.IsNullOrEmpty(sourcePath) ? "" : Path.GetFileName(sourcePath),
                "source", SourceTag,
                "tile_mode", db.TileMode,
                "measurement", db.Measurement.ToString(),
                "insunits", db.Insunits.ToString(),
                "original_file_version", db.OriginalFileVersion.ToString(),
                "last_saved_as_version", db.LastSavedAsVersion.ToString(),
                "block_inventory", blockInventory);

            var report = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "drawing_id", drawingId,
                "source_path", sourcePath,
                "source_sha256", TryHash(sourcePath),
                "source_size_bytes", TrySize(sourcePath),
                "started_at", startedAt,
                "completed_at", DateTime.UtcNow,
                "elapsed_ms", Math.Round((DateTime.UtcNow - startedAt).TotalMilliseconds, 1),
                "host", HostInfo(),
                "entity_count", entityCount,
                "proxy_count", proxyCount,
                "failed_count", failedCount,
                "did_not_save", true,
                "type_counts", typeCounts,
                "layer_counts", layerCounts,
                "owner_scope_counts", ownerCounts,
                "decode_status_counts", decodeCounts,
                "output_dir", outDir);

            AtomicWrite(Path.Combine(outDir, "drawing.json"), JsonUtil.Serialize(drawing));
            AtomicWrite(Path.Combine(outDir, "tables.json"), JsonUtil.Serialize(tables));
            AtomicWrite(Path.Combine(outDir, "extraction-report.json"), JsonUtil.Serialize(report));
            return Path.Combine(outDir, "extraction-report.json");
        }

        static Dictionary<string, object> SerializeEntity(
            Entity ent,
            BlockTableRecord owner,
            string ownerScope,
            Transaction tr)
        {
            bool isProxy = ent.IsAProxy || ent is ProxyEntity;
            var record = new Dictionary<string, object>(StringComparer.Ordinal)
            {
                { "drawing_handle", HandleOf(ent.Id) },
                { "handle", HandleOf(ent) },
                { "runtime_class", RxName(ent) },
                { "managed_type", ent.GetType().Name },
                { "dxf_name", Safe(() => ent.GetRXClass().DxfName) },
                { "semantic_type", null },
                { "layer", Safe(() => ent.Layer) },
                { "color", ColorOf(ent) },
                { "linetype", Safe(() => ent.Linetype) },
                { "lineweight", Safe(() => (int)ent.LineWeight) },
                { "visible", Safe(() => ent.Visible) },
                { "owner_scope", ownerScope },
                { "owner_block_name", owner.Name },
                { "owner_handle", HandleOf(owner) },
                { "block_path", new[] { owner.Name } },
                { "bbox", BBoxOf(ent) },
                { "geometry", GeometryOf(ent, tr) },
                { "text", TextOf(ent) },
                { "attributes", AttributesOf(ent, tr) },
                { "xdata", XDataOf(ent) },
                { "extension_dictionary", ExtDictOf(ent, tr) },
                { "source", SourceTag },
                { "decode_status", isProxy ? "proxy" : "full" }
            };

            var proxy = ent as ProxyEntity;
            if (proxy != null)
            {
                record["proxy"] = Map(
                    "original_class_name", Safe(() => proxy.OriginalClassName),
                    "original_dxf_name", Safe(() => proxy.OriginalDxfName),
                    "application_description", Safe(() => proxy.ApplicationDescription),
                    "proxy_flags", Safe(() => (int)proxy.ProxyFlags));
            }

            return record;
        }

        static Dictionary<string, object> GeometryOf(Entity ent, Transaction tr)
        {
            try
            {
                var line = ent as Line;
                if (line != null)
                {
                    return Map("kind", "line", "start", Pt(line.StartPoint), "end", Pt(line.EndPoint));
                }

                var circle = ent as Circle;
                if (circle != null)
                {
                    return Map("kind", "circle", "center", Pt(circle.Center), "radius", circle.Radius,
                        "normal", Pt(circle.Normal));
                }

                var arc = ent as Arc;
                if (arc != null)
                {
                    return Map("kind", "arc", "center", Pt(arc.Center), "radius", arc.Radius,
                        "start_angle", arc.StartAngle, "end_angle", arc.EndAngle, "normal", Pt(arc.Normal));
                }

                var ellipse = ent as Ellipse;
                if (ellipse != null)
                {
                    return Map("kind", "ellipse", "center", Pt(ellipse.Center),
                        "major_axis", Pt(ellipse.MajorAxis), "radius_ratio", ellipse.RadiusRatio,
                        "start_angle", ellipse.StartAngle, "end_angle", ellipse.EndAngle);
                }

                var pl = ent as Polyline;
                if (pl != null)
                {
                    return PolylineGeometry(pl);
                }

                var pl2 = ent as Polyline2d;
                if (pl2 != null)
                {
                    return Polyline2dGeometry(pl2, tr);
                }

                var pl3 = ent as Polyline3d;
                if (pl3 != null)
                {
                    return Polyline3dGeometry(pl3, tr);
                }

                var spline = ent as Spline;
                if (spline != null)
                {
                    return SplineGeometry(spline);
                }

                var text = ent as DBText;
                if (text != null)
                {
                    return Map("kind", "text", "position", Pt(text.Position), "height", text.Height,
                        "rotation", text.Rotation, "alignment", Pt(text.AlignmentPoint),
                        "horizontal_mode", text.HorizontalMode.ToString());
                }

                var mtext = ent as MText;
                if (mtext != null)
                {
                    return Map("kind", "mtext", "location", Pt(mtext.Location), "height", mtext.TextHeight,
                        "width", mtext.Width, "rotation", mtext.Rotation, "attachment",
                        mtext.Attachment.ToString());
                }

                var br = ent as BlockReference;
                if (br != null)
                {
                    string blockName = br.Name;
                    try
                    {
                        var btr = (BlockTableRecord)tr.GetObject(br.BlockTableRecord, OpenMode.ForRead);
                        blockName = btr.Name;
                    }
                    catch (AcException)
                    {
                    }

                    return Map(
                        "kind", "block_reference",
                        "block_name", blockName,
                        "position", Pt(br.Position),
                        "rotation", br.Rotation,
                        "scale", new[] { br.ScaleFactors.X, br.ScaleFactors.Y, br.ScaleFactors.Z },
                        "normal", Pt(br.Normal),
                        "is_dynamic", Safe(() => br.IsDynamicBlock));
                }

                var hatch = ent as Hatch;
                if (hatch != null)
                {
                    return Map("kind", "hatch", "pattern", hatch.PatternName, "pattern_type",
                        hatch.PatternType.ToString(), "associative", hatch.Associative, "hatch_style",
                        hatch.HatchStyle.ToString());
                }

                var dim = ent as Dimension;
                if (dim != null)
                {
                    return Map("kind", "dimension", "dim_type", dim.GetType().Name,
                        "measurement", Safe(() => dim.Measurement),
                        "text_position", Safe(() => Pt(dim.TextPosition)),
                        "dim_style", Safe(() => dim.DimensionStyleName));
                }

                var leader = ent as Leader;
                if (leader != null)
                {
                    return Map("kind", "leader", "has_arrow_head", leader.HasArrowHead);
                }

                var solid = ent as Solid;
                if (solid != null)
                {
                    return Map("kind", "solid");
                }

                var region = ent as Region;
                if (region != null)
                {
                    return Map("kind", "region");
                }

                var solid3d = ent as Solid3d;
                if (solid3d != null)
                {
                    return Map("kind", "solid3d");
                }

                var table = ent as Table;
                if (table != null)
                {
                    return Map("kind", "table", "rows", Safe(() => table.Rows.Count),
                        "columns", Safe(() => table.Columns.Count));
                }

                var viewport = ent as Viewport;
                if (viewport != null)
                {
                    return Map("kind", "viewport", "number", viewport.Number, "on", viewport.On,
                        "custom_scale", viewport.CustomScale);
                }

                var attDef = ent as AttributeDefinition;
                if (attDef != null)
                {
                    return Map("kind", "attdef", "tag", attDef.Tag, "position", Pt(attDef.Position),
                        "height", attDef.Height, "invisible", attDef.Invisible);
                }

                var wipeout = ent as Wipeout;
                if (wipeout != null)
                {
                    return Map("kind", "wipeout");
                }

                var proxy = ent as ProxyEntity;
                if (proxy != null)
                {
                    return Map("kind", "proxy");
                }

                return Map("kind", "unparsed", "managed_type", ent.GetType().Name);
            }
            catch (System.Exception ex)
            {
                return Map("kind", "error", "error", Clip(ex.Message, 512));
            }
        }

        static Dictionary<string, object> PolylineGeometry(Polyline pl)
        {
            int n = pl.NumberOfVertices;
            int emit = Math.Min(n, MaxPolylineVertices);
            var vertices = new List<object>(emit);
            for (int i = 0; i < emit; i++)
            {
                vertices.Add(Map(
                    "point", Pt(pl.GetPoint3dAt(i)),
                    "bulge", pl.GetBulgeAt(i)));
            }

            return Map("kind", "lwpolyline", "closed", pl.Closed, "elevation", pl.Elevation,
                "constant_width", pl.ConstantWidth, "vertex_count", n, "vertices_truncated", n > emit,
                "vertices", vertices);
        }

        static Dictionary<string, object> Polyline2dGeometry(Polyline2d pl, Transaction tr)
        {
            var vertices = new List<object>();
            int n = 0;
            foreach (ObjectId id in pl)
            {
                n++;
                if (vertices.Count >= MaxPolylineVertices)
                {
                    continue;
                }

                var v = tr.GetObject(id, OpenMode.ForRead) as Vertex2d;
                if (v != null)
                {
                    vertices.Add(Map("point", Pt(v.Position), "bulge", v.Bulge));
                }
            }

            return Map("kind", "polyline2d", "closed", pl.Closed, "vertex_count", n,
                "vertices_truncated", n > vertices.Count, "vertices", vertices);
        }

        static Dictionary<string, object> Polyline3dGeometry(Polyline3d pl, Transaction tr)
        {
            var vertices = new List<object>();
            int n = 0;
            foreach (ObjectId id in pl)
            {
                n++;
                if (vertices.Count >= MaxPolylineVertices)
                {
                    continue;
                }

                var v = tr.GetObject(id, OpenMode.ForRead) as PolylineVertex3d;
                if (v != null)
                {
                    vertices.Add(Pt(v.Position));
                }
            }

            return Map("kind", "polyline3d", "closed", pl.Closed, "vertex_count", n,
                "vertices_truncated", n > vertices.Count, "vertices", vertices);
        }

        static Dictionary<string, object> SplineGeometry(Spline spline)
        {
            int n = spline.NumControlPoints;
            int emit = Math.Min(n, MaxSplinePoints);
            var points = new List<object>(emit);
            for (int i = 0; i < emit; i++)
            {
                points.Add(Pt(spline.GetControlPointAt(i)));
            }

            return Map("kind", "spline", "degree", spline.Degree, "closed", spline.Closed,
                "control_point_count", n, "control_points_truncated", n > emit, "control_points", points);
        }

        static object TextOf(Entity ent)
        {
            var text = ent as DBText;
            if (text != null)
            {
                return text.TextString;
            }

            var mtext = ent as MText;
            if (mtext != null)
            {
                return Map("contents", mtext.Contents, "plain", Safe(() => mtext.Text));
            }

            var att = ent as AttributeReference;
            if (att != null)
            {
                return Map("tag", att.Tag, "value", att.TextString);
            }

            var attDef = ent as AttributeDefinition;
            if (attDef != null)
            {
                return Map("tag", attDef.Tag, "prompt", attDef.Prompt, "value", attDef.TextString);
            }

            var dim = ent as Dimension;
            if (dim != null)
            {
                return Map("dimension_text", dim.DimensionText, "measurement", Safe(() => dim.Measurement));
            }

            return null;
        }

        static object AttributesOf(Entity ent, Transaction tr)
        {
            var br = ent as BlockReference;
            if (br == null || br.AttributeCollection == null || br.AttributeCollection.Count == 0)
            {
                return null;
            }

            var list = new List<object>();
            foreach (ObjectId id in br.AttributeCollection)
            {
                try
                {
                    var ar = tr.GetObject(id, OpenMode.ForRead) as AttributeReference;
                    if (ar == null)
                    {
                        continue;
                    }

                    list.Add(Map(
                        "handle", HandleOf(ar),
                        "tag", ar.Tag,
                        "value", ar.TextString,
                        "invisible", ar.Invisible,
                        "position", Pt(ar.Position)));
                }
                catch (AcException)
                {
                }
            }

            return list.Count == 0 ? null : list;
        }

        static object XDataOf(DBObject obj)
        {
            ResultBuffer rb = obj.XData;
            if (rb == null)
            {
                return null;
            }

            var result = new Dictionary<string, List<object>>(StringComparer.Ordinal);
            string app = null;
            List<object> cur = null;
            foreach (TypedValue tv in rb)
            {
                if (tv.TypeCode == (short)DxfCode.ExtendedDataRegAppName)
                {
                    app = Convert.ToString(tv.Value, CultureInfo.InvariantCulture) ?? "";
                    cur = new List<object>();
                    result[app] = cur;
                }
                else if (cur != null)
                {
                    cur.Add(Map("code", (int)tv.TypeCode, "value", TvValue(tv.Value)));
                }
            }

            return result.Count == 0 ? null : result;
        }

        static object ExtDictOf(DBObject obj, Transaction tr)
        {
            if (obj.ExtensionDictionary.IsNull)
            {
                return null;
            }

            try
            {
                var dict = tr.GetObject(obj.ExtensionDictionary, OpenMode.ForRead, false) as DBDictionary;
                return dict == null ? null : DumpDictionary(dict, tr, MaxDictionaryDepth);
            }
            catch (AcException)
            {
                return Map("error", "extension_dictionary_unreadable");
            }
        }

        static object DumpDictionary(DBDictionary dict, Transaction tr, int depth)
        {
            var items = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (DBDictionaryEntry entry in dict)
            {
                try
                {
                    DBObject child = tr.GetObject(entry.Value, OpenMode.ForRead, false);
                    items[entry.Key] = DumpDbObject(child, tr, depth - 1);
                }
                catch (System.Exception ex)
                {
                    items[entry.Key] = Map("error", Clip(ex.Message, 512));
                }
            }

            return Map(
                "handle", HandleOf(dict),
                "runtime_class", RxName(dict),
                "is_proxy", dict.IsAProxy,
                "count", dict.Count,
                "items", items);
        }

        static object DumpDbObject(DBObject obj, Transaction tr, int depth)
        {
            var xr = obj as Xrecord;
            if (xr != null)
            {
                var values = new List<object>();
                if (xr.Data != null)
                {
                    foreach (TypedValue tv in xr.Data)
                    {
                        values.Add(Map("code", (int)tv.TypeCode, "value", TvValue(tv.Value)));
                    }
                }

                return Map("kind", "xrecord", "handle", HandleOf(xr), "is_proxy", xr.IsAProxy, "data", values);
            }

            var nested = obj as DBDictionary;
            if (nested != null)
            {
                if (depth <= 0)
                {
                    return Map("kind", "dictionary", "handle", HandleOf(nested), "truncated", true,
                        "count", nested.Count);
                }

                return DumpDictionary(nested, tr, depth);
            }

            return Map(
                "kind", "object",
                "handle", HandleOf(obj),
                "runtime_class", RxName(obj),
                "managed_type", obj.GetType().Name,
                "is_proxy", obj.IsAProxy);
        }

        static void DumpNamedObjects(Database db, Transaction tr, StreamWriter writer)
        {
            var nod = tr.GetObject(db.NamedObjectsDictionaryId, OpenMode.ForRead) as DBDictionary;
            if (nod == null)
            {
                return;
            }

            foreach (DBDictionaryEntry entry in nod)
            {
                try
                {
                    DBObject child = tr.GetObject(entry.Value, OpenMode.ForRead, false);
                    WriteLine(writer, Map(
                        "key", entry.Key,
                        "object", DumpDbObject(child, tr, MaxDictionaryDepth)));
                }
                catch (System.Exception ex)
                {
                    WriteLine(writer, Map("key", entry.Key, "error", Clip(ex.Message, 512)));
                }
            }
        }

        static Dictionary<string, object> DumpTables(
            Database db,
            Transaction tr,
            out List<Dictionary<string, object>> blockInventory)
        {
            var layers = new List<object>();
            var layerTable = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
            foreach (ObjectId id in layerTable)
            {
                var rec = (LayerTableRecord)tr.GetObject(id, OpenMode.ForRead);
                layers.Add(Map(
                    "name", rec.Name,
                    "handle", HandleOf(rec),
                    "off", rec.IsOff,
                    "frozen", rec.IsFrozen,
                    "locked", rec.IsLocked,
                    "color", rec.Color.ToString(),
                    "linetype", Safe(() =>
                    {
                        var lt = (LinetypeTableRecord)tr.GetObject(rec.LinetypeObjectId, OpenMode.ForRead);
                        return lt.Name;
                    })));
            }

            var linetypes = new List<object>();
            var linetypeTable = (LinetypeTable)tr.GetObject(db.LinetypeTableId, OpenMode.ForRead);
            foreach (ObjectId id in linetypeTable)
            {
                var rec = (LinetypeTableRecord)tr.GetObject(id, OpenMode.ForRead);
                linetypes.Add(Map("name", rec.Name, "handle", HandleOf(rec), "ascii_description", rec.AsciiDescription));
            }

            var textStyles = new List<object>();
            var textTable = (TextStyleTable)tr.GetObject(db.TextStyleTableId, OpenMode.ForRead);
            foreach (ObjectId id in textTable)
            {
                var rec = (TextStyleTableRecord)tr.GetObject(id, OpenMode.ForRead);
                textStyles.Add(Map(
                    "name", rec.Name,
                    "handle", HandleOf(rec),
                    "font_file", rec.FileName,
                    "big_font_file", rec.BigFontFileName,
                    "text_size", rec.TextSize));
            }

            var dimStyles = new List<object>();
            var dimTable = (DimStyleTable)tr.GetObject(db.DimStyleTableId, OpenMode.ForRead);
            foreach (ObjectId id in dimTable)
            {
                var rec = (DimStyleTableRecord)tr.GetObject(id, OpenMode.ForRead);
                dimStyles.Add(Map("name", rec.Name, "handle", HandleOf(rec)));
            }

            var apps = new List<object>();
            var appTable = (RegAppTable)tr.GetObject(db.RegAppTableId, OpenMode.ForRead);
            foreach (ObjectId id in appTable)
            {
                var rec = (RegAppTableRecord)tr.GetObject(id, OpenMode.ForRead);
                apps.Add(Map("name", rec.Name, "handle", HandleOf(rec)));
            }

            blockInventory = new List<Dictionary<string, object>>();
            var bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
            foreach (ObjectId id in bt)
            {
                var btr = (BlockTableRecord)tr.GetObject(id, OpenMode.ForRead);
                int count = 0;
                foreach (ObjectId ignored in btr)
                {
                    count++;
                }

                blockInventory.Add(Map(
                    "name", btr.Name,
                    "handle", HandleOf(btr),
                    "owner_scope", OwnerScope(btr),
                    "is_layout", btr.IsLayout,
                    "is_anonymous", btr.IsAnonymous,
                    "is_from_xref", btr.IsFromExternalReference,
                    "xref_path", btr.PathName,
                    "has_attribute_definitions", btr.HasAttributeDefinitions,
                    "entity_count", count,
                    "origin", Pt(btr.Origin)));
            }

            var layouts = new List<object>();
            var layoutDict = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
            foreach (DBDictionaryEntry entry in layoutDict)
            {
                var layout = tr.GetObject(entry.Value, OpenMode.ForRead) as Layout;
                if (layout == null)
                {
                    continue;
                }

                layouts.Add(Map(
                    "name", layout.LayoutName,
                    "handle", HandleOf(layout),
                    "tab_order", layout.TabOrder,
                    "model_type", layout.ModelType,
                    "block_handle", HandleOf(layout.BlockTableRecordId)));
            }

            return Map(
                "layers", layers,
                "linetypes", linetypes,
                "text_styles", textStyles,
                "dim_styles", dimStyles,
                "reg_apps", apps,
                "layouts", layouts,
                "blocks", blockInventory);
        }

        static string OwnerScope(BlockTableRecord btr)
        {
            if (btr.IsLayout)
            {
                if (string.Equals(btr.Name, BlockTableRecord.ModelSpace, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(btr.Name, "*MODEL_SPACE", StringComparison.OrdinalIgnoreCase))
                {
                    return "model_space";
                }

                return "paper_space";
            }

            if (btr.IsFromExternalReference)
            {
                return "xref";
            }

            return "block_definition";
        }

        static Dictionary<string, object> HostInfo()
        {
            string version = "unknown";
            try
            {
                version = CoreApp.Version.ToString();
            }
            catch
            {
            }

            return Map(
                "application", "AutoCAD",
                "application_version", version,
                "plugin", "Shb.AutoCAD.Extractor",
                "plugin_version", "0.1.0",
                "clr", Environment.Version.ToString(),
                "machine", Environment.MachineName);
        }

        static object BBoxOf(Entity ent)
        {
            try
            {
                Extents3d ext = ent.GeometricExtents;
                return Map("min", Pt(ext.MinPoint), "max", Pt(ext.MaxPoint));
            }
            catch
            {
                return null;
            }
        }

        static object ColorOf(Entity ent)
        {
            try
            {
                var c = ent.Color;
                return Map(
                    "index", c.ColorIndex,
                    "is_by_layer", c.IsByLayer,
                    "is_by_block", c.IsByBlock,
                    "name", c.ToString());
            }
            catch
            {
                return null;
            }
        }

        static double[] Pt(Point3d p)
        {
            return new[] { p.X, p.Y, p.Z };
        }

        static double[] Pt(Vector3d v)
        {
            return new[] { v.X, v.Y, v.Z };
        }

        static object TvValue(object value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is Point3d)
            {
                return Pt((Point3d)value);
            }

            if (value is Point2d)
            {
                var p = (Point2d)value;
                return new[] { p.X, p.Y };
            }

            if (value is ObjectId)
            {
                return HandleOf((ObjectId)value);
            }

            if (value is byte[])
            {
                return (byte[])value;
            }

            return value;
        }

        static string RxName(DBObject obj)
        {
            try
            {
                return obj.GetRXClass().Name;
            }
            catch
            {
                return obj.GetType().Name;
            }
        }

        static string HandleOf(DBObject obj)
        {
            try
            {
                return obj.Handle.ToString();
            }
            catch
            {
                return "";
            }
        }

        static string HandleOf(ObjectId id)
        {
            try
            {
                return id.Handle.ToString();
            }
            catch
            {
                return "";
            }
        }

        static object Safe(Func<object> getter)
        {
            try
            {
                return getter();
            }
            catch
            {
                return null;
            }
        }

        static void Bump(Dictionary<string, int> counts, string key)
        {
            if (key == null)
            {
                key = "unknown";
            }

            int n;
            counts.TryGetValue(key, out n);
            counts[key] = n + 1;
        }

        static Dictionary<string, object> Map(params object[] pairs)
        {
            if (pairs.Length % 2 != 0)
            {
                throw new ArgumentException("pairs");
            }

            var map = new Dictionary<string, object>(pairs.Length / 2, StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2)
            {
                map[(string)pairs[i]] = pairs[i + 1];
            }

            return map;
        }

        static string Clip(string text, int max)
        {
            if (text == null)
            {
                return "";
            }

            return text.Length <= max ? text : text.Substring(0, max);
        }

        static string SafeStem(string path)
        {
            string name = Path.GetFileNameWithoutExtension(path);
            foreach (char c in Path.GetInvalidFileNameChars())
            {
                name = name.Replace(c, '_');
            }

            return string.IsNullOrWhiteSpace(name) ? "unnamed" : name;
        }

        static string TryHash(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    return null;
                }

                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sha = SHA256.Create())
                {
                    byte[] hash = sha.ComputeHash(stream);
                    var sb = new StringBuilder(hash.Length * 2);
                    foreach (byte b in hash)
                    {
                        sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                    }

                    return sb.ToString();
                }
            }
            catch
            {
                return null;
            }
        }

        static object TrySize(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    return null;
                }

                return new FileInfo(path).Length;
            }
            catch
            {
                return null;
            }
        }

        static StreamWriter NewWriter(string path)
        {
            return new StreamWriter(path, false, new UTF8Encoding(false));
        }

        static void WriteLine(StreamWriter writer, object value)
        {
            writer.WriteLine(JsonUtil.Serialize(value));
        }

        static void AtomicWrite(string path, string content)
        {
            string tmp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(tmp, content + "\n", new UTF8Encoding(false));
            if (File.Exists(path))
            {
                File.Delete(path);
            }

            File.Move(tmp, path);
        }
    }
}
