using System;
using System.Collections.Generic;
using System.Globalization;
using Teigha.DatabaseServices;
using Teigha.Geometry;

namespace Shb.Thcad.TextInventory
{
    internal static class TextInventoryExtractor
    {
        const string SchemaVersion = "1";
        const string SourceTag = "thcad_v24_dotnet_side_database";

        public static Dictionary<string, object> Extract(Database database, string sourcePath)
        {
            if (database == null)
            {
                throw new ArgumentNullException("database");
            }

            var records = new List<object>();
            var titleBlocks = new List<object>();
            var sourceCounts = new Dictionary<string, int>(StringComparer.Ordinal);

            using (Transaction transaction = database.TransactionManager.StartTransaction())
            {
                BlockTable blockTable = (BlockTable)transaction.GetObject(
                    database.BlockTableId,
                    OpenMode.ForRead);
                foreach (ObjectId ownerId in blockTable)
                {
                    BlockTableRecord owner = (BlockTableRecord)transaction.GetObject(
                        ownerId,
                        OpenMode.ForRead);
                    string ownerScope = OwnerScope(owner);
                    foreach (ObjectId entityId in owner)
                    {
                        Entity entity = transaction.GetObject(
                            entityId,
                            OpenMode.ForRead,
                            false) as Entity;
                        if (entity == null)
                        {
                            continue;
                        }

                        BlockReference blockReference = entity as BlockReference;
                        if (blockReference != null)
                        {
                            AddBlockReferenceRecords(
                                records,
                                titleBlocks,
                                sourceCounts,
                                blockReference,
                                owner,
                                ownerScope,
                                transaction);
                            continue;
                        }

                        AttributeReference attribute = entity as AttributeReference;
                        if (attribute != null)
                        {
                            AddRecord(records, sourceCounts, Record(
                                "block_attribute",
                                attribute.TextString,
                                attribute,
                                owner,
                                ownerScope,
                                Point(attribute.Position),
                                "tag", attribute.Tag));
                            continue;
                        }

                        AttributeDefinition attributeDefinition = entity as AttributeDefinition;
                        if (attributeDefinition != null)
                        {
                            AddRecord(records, sourceCounts, Record(
                                "attribute_definition",
                                attributeDefinition.TextString,
                                attributeDefinition,
                                owner,
                                ownerScope,
                                Point(attributeDefinition.Position),
                                "tag", attributeDefinition.Tag,
                                "prompt", attributeDefinition.Prompt));
                            continue;
                        }

                        DBText dbText = entity as DBText;
                        if (dbText != null)
                        {
                            AddRecord(records, sourceCounts, Record(
                                "dbtext",
                                dbText.TextString,
                                dbText,
                                owner,
                                ownerScope,
                                Point(dbText.Position)));
                            continue;
                        }

                        MText mtext = entity as MText;
                        if (mtext != null)
                        {
                            AddRecord(records, sourceCounts, Record(
                                "mtext",
                                SafeString(delegate { return mtext.Text; }, mtext.Contents),
                                mtext,
                                owner,
                                ownerScope,
                                Point(mtext.Location),
                                "raw_text", mtext.Contents));
                            continue;
                        }

                        Dimension dimension = entity as Dimension;
                        if (dimension != null)
                        {
                            object measurement = Safe(delegate { return (object)dimension.Measurement; });
                            string display = SafeString(delegate { return dimension.DimensionText; }, "");
                            if (string.IsNullOrWhiteSpace(display) || display == "<>")
                            {
                                display = measurement == null
                                    ? ""
                                    : Convert.ToString(measurement, CultureInfo.InvariantCulture);
                            }
                            AddRecord(records, sourceCounts, Record(
                                "dimension",
                                display,
                                dimension,
                                owner,
                                ownerScope,
                                SafePoint(delegate { return dimension.TextPosition; }),
                                "dimension_text", SafeString(delegate { return dimension.DimensionText; }, ""),
                                "measurement", measurement,
                                "dimension_type", dimension.GetType().Name));
                            continue;
                        }

                        MLeader mleader = entity as MLeader;
                        if (mleader != null)
                        {
                            string value = "";
                            try
                            {
                                MText leaderText = mleader.MText;
                                value = leaderText == null ? "" : leaderText.Text;
                            }
                            catch
                            {
                            }
                            AddRecord(records, sourceCounts, Record(
                                "mleader",
                                value,
                                mleader,
                                owner,
                                ownerScope,
                                SafePoint(delegate { return mleader.TextLocation; })));
                        }
                    }
                }
                transaction.Commit();
            }

            DatabaseSummaryInfo summary = default(DatabaseSummaryInfo);
            bool hasSummary = false;
            try
            {
                summary = database.SummaryInfo;
                hasSummary = true;
            }
            catch
            {
            }

            return Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "source_path", sourcePath ?? "",
                "database_filename", database.Filename ?? "",
                "record_count", records.Count,
                "source_counts", sourceCounts,
                "title_metadata", Map(
                    "summary_info", !hasSummary ? null : Map(
                        "title", summary.Title,
                        "subject", summary.Subject,
                        "author", summary.Author,
                        "keywords", summary.Keywords,
                        "comments", summary.Comments),
                    "title_blocks", titleBlocks),
                "records", records);
        }

        static void AddBlockReferenceRecords(
            List<object> records,
            List<object> titleBlocks,
            IDictionary<string, int> sourceCounts,
            BlockReference reference,
            BlockTableRecord owner,
            string ownerScope,
            Transaction transaction)
        {
            string blockName = BlockName(reference, transaction);
            AddRecord(records, sourceCounts, Record(
                "block_name",
                blockName,
                reference,
                owner,
                ownerScope,
                Point(reference.Position),
                "block_name", blockName));

            var attributes = new List<Dictionary<string, object>>();
            var fields = new Dictionary<string, object>(StringComparer.Ordinal);
            if (reference.AttributeCollection != null)
            {
                foreach (ObjectId attributeId in reference.AttributeCollection)
                {
                    try
                    {
                        AttributeReference attribute = transaction.GetObject(
                            attributeId,
                            OpenMode.ForRead,
                            false) as AttributeReference;
                        if (attribute == null)
                        {
                            continue;
                        }
                        string tag = attribute.Tag ?? "";
                        string value = attribute.TextString ?? "";
                        fields[tag] = value;
                        attributes.Add(Map(
                            "handle", HandleOf(attribute),
                            "runtime_class", RxName(attribute),
                            "tag", tag,
                            "value", value,
                            "position", Point(attribute.Position),
                            "layer", SafeString(delegate { return attribute.Layer; }, ""),
                            "bbox", BoundsOf(attribute)));
                    }
                    catch
                    {
                    }
                }
            }

            int? bomItemNumber = ItemNumber(fields);
            foreach (Dictionary<string, object> attribute in attributes)
            {
                var record = Record(
                    "block_attribute",
                    Convert.ToString(attribute["value"], CultureInfo.InvariantCulture),
                    reference,
                    owner,
                    ownerScope,
                    attribute["position"],
                    "handle", attribute["handle"],
                    "runtime_class", attribute["runtime_class"],
                    "owner_handle", HandleOf(reference),
                    "block_name", blockName,
                    "tag", attribute["tag"],
                    "layer", attribute["layer"],
                    "bbox", attribute["bbox"]);
                if (bomItemNumber.HasValue)
                {
                    record["bom_item_number"] = bomItemNumber.Value;
                }
                AddRecord(records, sourceCounts, record);
            }

            if (string.Equals(blockName, "PC_MXB_BLOCK", StringComparison.OrdinalIgnoreCase))
            {
                var row = Record(
                    "bom_row",
                    JoinFields(fields),
                    reference,
                    owner,
                    ownerScope,
                    Point(reference.Position),
                    "block_name", blockName,
                    "fields", fields);
                if (bomItemNumber.HasValue)
                {
                    row["bom_item_number"] = bomItemNumber.Value;
                }
                AddRecord(records, sourceCounts, row);
            }
            else if (string.Equals(blockName, "PC_TITLE_BLOCK", StringComparison.OrdinalIgnoreCase))
            {
                var title = Map(
                    "handle", HandleOf(reference),
                    "position", Point(reference.Position),
                    "fields", fields);
                titleBlocks.Add(title);
                AddRecord(records, sourceCounts, Record(
                    "title_block",
                    JoinFields(fields),
                    reference,
                    owner,
                    ownerScope,
                    Point(reference.Position),
                    "block_name", blockName,
                    "fields", fields));
            }
        }

        static Dictionary<string, object> Record(
            string source,
            string text,
            Entity entity,
            BlockTableRecord owner,
            string ownerScope,
            object position,
            params object[] extras)
        {
            var result = Map(
                "source", source,
                "text", text ?? "",
                "handle", HandleOf(entity),
                "runtime_class", RxName(entity),
                "layer", SafeString(delegate { return entity.Layer; }, ""),
                "owner_scope", ownerScope,
                "owner_block_name", owner == null ? "" : owner.Name,
                "owner_handle", owner == null ? "" : HandleOf(owner),
                "position", position,
                "bbox", BoundsOf(entity));
            for (int index = 0; index + 1 < extras.Length; index += 2)
            {
                result[Convert.ToString(extras[index], CultureInfo.InvariantCulture)] = extras[index + 1];
            }
            return result;
        }

        static void AddRecord(
            IList<object> records,
            IDictionary<string, int> sourceCounts,
            Dictionary<string, object> record)
        {
            string text = record.ContainsKey("text")
                ? Convert.ToString(record["text"], CultureInfo.InvariantCulture)
                : "";
            string source = Convert.ToString(record["source"], CultureInfo.InvariantCulture);
            if (string.IsNullOrWhiteSpace(text) && source != "block_name")
            {
                return;
            }
            records.Add(record);
            int count;
            sourceCounts.TryGetValue(source, out count);
            sourceCounts[source] = count + 1;
        }

        static int? ItemNumber(IDictionary<string, object> fields)
        {
            object raw;
            if (!fields.TryGetValue("序号", out raw))
            {
                return null;
            }
            int value;
            return int.TryParse(
                Convert.ToString(raw, CultureInfo.InvariantCulture).Trim(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out value)
                ? (int?)value
                : null;
        }

        static string JoinFields(IDictionary<string, object> fields)
        {
            var parts = new List<string>();
            foreach (KeyValuePair<string, object> field in fields)
            {
                string value = Convert.ToString(field.Value, CultureInfo.InvariantCulture) ?? "";
                if (!string.IsNullOrWhiteSpace(value))
                {
                    parts.Add(field.Key + ": " + value.Trim());
                }
            }
            return string.Join(" | ", parts.ToArray());
        }

        static string BlockName(BlockReference reference, Transaction transaction)
        {
            try
            {
                BlockTableRecord definition = transaction.GetObject(
                    reference.BlockTableRecord,
                    OpenMode.ForRead) as BlockTableRecord;
                return definition == null ? reference.Name : definition.Name;
            }
            catch
            {
                return SafeString(delegate { return reference.Name; }, "");
            }
        }

        static string OwnerScope(BlockTableRecord owner)
        {
            if (owner == null)
            {
                return "unknown";
            }
            if (owner.IsFromExternalReference)
            {
                return "xref";
            }
            if (owner.IsLayout)
            {
                if (string.Equals(owner.Name, BlockTableRecord.ModelSpace, StringComparison.OrdinalIgnoreCase))
                {
                    return "model_space";
                }
                return "paper_space";
            }
            return "block_definition";
        }

        static object BoundsOf(Entity entity)
        {
            try
            {
                Extents3d extents = entity.GeometricExtents;
                return Map("min", Point(extents.MinPoint), "max", Point(extents.MaxPoint));
            }
            catch
            {
                return null;
            }
        }

        static object SafePoint(Func<Point3d> getter)
        {
            try
            {
                return Point(getter());
            }
            catch
            {
                return null;
            }
        }

        static object Point(Point3d point)
        {
            return new[] { point.X, point.Y, point.Z };
        }

        static string HandleOf(DBObject value)
        {
            try
            {
                return value.Handle.ToString().ToUpperInvariant();
            }
            catch
            {
                return "";
            }
        }

        static string RxName(DBObject value)
        {
            try
            {
                return value.GetRXClass().Name;
            }
            catch
            {
                return value.GetType().Name;
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

        static string SafeString(Func<string> getter, string fallback)
        {
            try
            {
                return getter() ?? fallback;
            }
            catch
            {
                return fallback;
            }
        }

        static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[Convert.ToString(values[index], CultureInfo.InvariantCulture)] = values[index + 1];
            }
            return result;
        }
    }
}
