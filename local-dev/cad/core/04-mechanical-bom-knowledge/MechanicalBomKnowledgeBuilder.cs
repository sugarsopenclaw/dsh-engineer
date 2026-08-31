using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Shb.Cad.Core
{
    public sealed class MechanicalBomCellObservation
    {
        public MechanicalBomCellObservation(
            string label,
            string rawValue,
            string handle,
            double x,
            double y)
        {
            Label = label ?? "";
            RawValue = rawValue ?? "";
            Handle = handle ?? "";
            X = x;
            Y = y;
        }

        public string Label { get; private set; }
        public string RawValue { get; private set; }
        public string Handle { get; private set; }
        public double X { get; private set; }
        public double Y { get; private set; }
    }

    public sealed class MechanicalBomRowObservation
    {
        public MechanicalBomRowObservation(
            string handle,
            double positionX,
            double positionY,
            double minX,
            double minY,
            double maxX,
            double maxY,
            string xdataItemNumber,
            IList<MechanicalBomCellObservation> cells)
        {
            Handle = handle ?? "";
            PositionX = positionX;
            PositionY = positionY;
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            XDataItemNumber = xdataItemNumber ?? "";
            Cells = cells == null
                ? new List<MechanicalBomCellObservation>()
                : new List<MechanicalBomCellObservation>(cells);
        }

        public string Handle { get; private set; }
        public double PositionX { get; private set; }
        public double PositionY { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public string XDataItemNumber { get; private set; }
        public IList<MechanicalBomCellObservation> Cells { get; private set; }
    }

    public sealed class MechanicalBomAnnotationObservation
    {
        public MechanicalBomAnnotationObservation(
            int itemNumber,
            string dictionaryKey,
            string xuhaoHandle,
            string associationRecordHandle,
            string associationRecordClass,
            bool entityPresent)
            : this(
                itemNumber,
                dictionaryKey,
                xuhaoHandle,
                associationRecordHandle,
                associationRecordClass,
                entityPresent,
                null,
                null)
        {
        }

        public MechanicalBomAnnotationObservation(
            int itemNumber,
            string dictionaryKey,
            string xuhaoHandle,
            string associationRecordHandle,
            string associationRecordClass,
            bool entityPresent,
            double[] pointingPosition,
            double[] numberPosition)
        {
            ItemNumber = itemNumber;
            DictionaryKey = dictionaryKey ?? "";
            XuhaoHandle = xuhaoHandle ?? "";
            AssociationRecordHandle = associationRecordHandle ?? "";
            AssociationRecordClass = associationRecordClass ?? "";
            EntityPresent = entityPresent;
            PointingPosition = CopyPosition(pointingPosition);
            NumberPosition = CopyPosition(numberPosition);
        }

        public int ItemNumber { get; private set; }
        public string DictionaryKey { get; private set; }
        public string XuhaoHandle { get; private set; }
        public string AssociationRecordHandle { get; private set; }
        public string AssociationRecordClass { get; private set; }
        public bool EntityPresent { get; private set; }
        public double[] PointingPosition { get; private set; }
        public double[] NumberPosition { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return MechanicalBomMaps.Map(
                "kind", "xuhao_annotation",
                "item_number", ItemNumber,
                "xuhao_handle", XuhaoHandle,
                "dictionary_key", DictionaryKey,
                "association_record_handle", AssociationRecordHandle,
                "association_record_class", AssociationRecordClass,
                "entity_present", EntityPresent,
                "pointing_position", PointingPosition,
                "number_position", NumberPosition);
        }

        static double[] CopyPosition(double[] position)
        {
            return position == null ? null : (double[])position.Clone();
        }
    }

    public sealed class MechanicalBomColumnDefinition
    {
        internal MechanicalBomColumnDefinition(
            int order,
            string key,
            string label,
            string valueType)
        {
            Order = order;
            Key = key;
            Label = label;
            ValueType = valueType;
        }

        public int Order { get; private set; }
        public string Key { get; private set; }
        public string Label { get; private set; }
        public string ValueType { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return MechanicalBomMaps.Map(
                "order", Order,
                "key", Key,
                "label", Label,
                "value_type", ValueType);
        }
    }

    public sealed class MechanicalBomSerialAnnotationLinkKnowledge
    {
        internal MechanicalBomSerialAnnotationLinkKnowledge(
            MechanicalBomAnnotationObservation source,
            MechanicalBomAnnotationObservation target,
            double centerDistance,
            double pointingResidual,
            double lineResidual,
            double projectionRatio)
        {
            Source = source;
            Target = target;
            CenterDistance = centerDistance;
            PointingResidual = pointingResidual;
            LineResidual = lineResidual;
            ProjectionRatio = projectionRatio;
        }

        internal MechanicalBomAnnotationObservation Source { get; private set; }
        internal MechanicalBomAnnotationObservation Target { get; private set; }
        public double CenterDistance { get; private set; }
        public double PointingResidual { get; private set; }
        public double LineResidual { get; private set; }
        public double ProjectionRatio { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return MechanicalBomMaps.Map(
                "relation", "serial_balloon_points_to_preceding_balloon",
                "source_item_number", Source.ItemNumber,
                "source_xuhao_handle", Source.XuhaoHandle,
                "target_item_number", Target.ItemNumber,
                "target_xuhao_handle", Target.XuhaoHandle,
                "center_distance", CenterDistance,
                "pointing_residual", PointingResidual,
                "line_residual", LineResidual,
                "projection_ratio", ProjectionRatio);
        }
    }

    public sealed class MechanicalBomSerialAnnotationGroupKnowledge
    {
        internal MechanicalBomSerialAnnotationGroupKnowledge(string id)
        {
            Id = id;
            Members = new List<MechanicalBomAnnotationObservation>();
            OrderedMembers = new List<MechanicalBomAnnotationObservation>();
            InternalLinks = new List<MechanicalBomSerialAnnotationLinkKnowledge>();
            ExternalTargetMembers = new List<MechanicalBomAnnotationObservation>();
        }

        public string Id { get; private set; }
        internal IList<MechanicalBomAnnotationObservation> Members { get; private set; }
        internal IList<MechanicalBomAnnotationObservation> OrderedMembers { get; private set; }
        public IList<MechanicalBomSerialAnnotationLinkKnowledge> InternalLinks { get; private set; }
        internal IList<MechanicalBomAnnotationObservation> ExternalTargetMembers { get; private set; }

        public int MemberCount { get { return Members.Count; } }
        public string GroupType
        {
            get { return Members.Count > 1 ? "connected_serial_run" : "single_serial"; }
        }

        public string TargetStatus
        {
            get
            {
                if (ExternalTargetMembers.Count == 1)
                {
                    return "resolved_shared_target";
                }
                if (ExternalTargetMembers.Count > 1)
                {
                    return "multiple_external_targets";
                }
                return "target_position_unavailable";
            }
        }

        public double[] TargetPoint
        {
            get
            {
                return ExternalTargetMembers.Count == 1
                    ? CopyPosition(ExternalTargetMembers[0].PointingPosition)
                    : null;
            }
        }

        public IList<int> ItemNumbers
        {
            get
            {
                var result = new List<int>();
                foreach (MechanicalBomAnnotationObservation member in OrderedMembers)
                {
                    if (!result.Contains(member.ItemNumber))
                    {
                        result.Add(member.ItemNumber);
                    }
                }
                return result;
            }
        }

        internal Dictionary<string, object> ToMap()
        {
            var members = new List<Dictionary<string, object>>();
            for (int index = 0; index < OrderedMembers.Count; index++)
            {
                MechanicalBomAnnotationObservation member = OrderedMembers[index];
                string role = ExternalTargetMembers.Contains(member)
                    ? "external_target_root"
                    : InternalLinks.Any(link => ReferenceEquals(link.Source, member))
                        ? "linked_serial_member"
                        : "number_only_member";
                members.Add(MechanicalBomMaps.Map(
                    "sequence", index + 1,
                    "item_number", member.ItemNumber,
                    "xuhao_handle", member.XuhaoHandle,
                    "role", role,
                    "number_position", member.NumberPosition,
                    "pointing_position", member.PointingPosition));
            }

            var links = new List<Dictionary<string, object>>();
            foreach (MechanicalBomSerialAnnotationLinkKnowledge link in InternalLinks)
            {
                links.Add(link.ToMap());
            }

            var externalTargets = new List<Dictionary<string, object>>();
            foreach (MechanicalBomAnnotationObservation member in ExternalTargetMembers)
            {
                externalTargets.Add(MechanicalBomMaps.Map(
                    "item_number", member.ItemNumber,
                    "xuhao_handle", member.XuhaoHandle,
                    "point", member.PointingPosition));
            }

            return MechanicalBomMaps.Map(
                "id", Id,
                "kind", "serial_annotation_group",
                "group_type", GroupType,
                "member_count", MemberCount,
                "item_numbers", ItemNumbers,
                "annotation_handles", OrderedMembers.Select(member => member.XuhaoHandle).ToArray(),
                "target_status", TargetStatus,
                "target_point", TargetPoint,
                "members", members,
                "internal_links", links,
                "external_targets", externalTargets,
                "derivation", "xuhao_number_and_pointing_geometry_graph");
        }

        static double[] CopyPosition(double[] position)
        {
            return position == null ? null : (double[])position.Clone();
        }
    }

    public sealed class MechanicalBomRowKnowledge
    {
        internal MechanicalBomRowKnowledge(MechanicalBomRowObservation source)
        {
            Source = source;
            Values = new Dictionary<string, string>(StringComparer.Ordinal);
            ParsedValues = new Dictionary<string, object>(StringComparer.Ordinal);
            CellHandles = new Dictionary<string, string>(StringComparer.Ordinal);
            CellPositions = new Dictionary<string, double[]>(StringComparer.Ordinal);
            MissingColumns = new List<string>();
            DuplicateLabels = new List<string>();
            Annotations = new List<MechanicalBomAnnotationObservation>();
        }

        internal MechanicalBomRowObservation Source { get; private set; }
        public string Id { get; internal set; }
        public int? ItemNumber { get; internal set; }
        public string XDataItemNumber { get { return Source.XDataItemNumber; } }
        public bool? ItemNumberMatchesXData { get; internal set; }
        public IDictionary<string, string> Values { get; private set; }
        public IDictionary<string, object> ParsedValues { get; private set; }
        public IDictionary<string, string> CellHandles { get; private set; }
        public IDictionary<string, double[]> CellPositions { get; private set; }
        public IList<string> MissingColumns { get; private set; }
        public IList<string> DuplicateLabels { get; private set; }
        public IList<MechanicalBomAnnotationObservation> Annotations { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            var annotations = new List<Dictionary<string, object>>();
            foreach (MechanicalBomAnnotationObservation annotation in Annotations)
            {
                annotations.Add(annotation.ToMap());
            }

            return MechanicalBomMaps.Map(
                "id", Id,
                "item_number", ItemNumber.HasValue ? (object)ItemNumber.Value : null,
                "values", Values,
                "parsed_values", ParsedValues,
                "annotations", annotations,
                "evidence", MechanicalBomMaps.Map(
                    "row_block_handle", Source.Handle,
                    "position", new[] { Source.PositionX, Source.PositionY },
                    "bbox", MechanicalBomMaps.Map(
                        "min", new[] { Source.MinX, Source.MinY },
                        "max", new[] { Source.MaxX, Source.MaxY }),
                    "cell_handles", CellHandles,
                    "cell_positions", CellPositions,
                    "th_xuhao", Source.XDataItemNumber,
                    "item_number_matches_th_xuhao", ItemNumberMatchesXData),
                "quality", MechanicalBomMaps.Map(
                    "missing_columns", MissingColumns,
                    "duplicate_labels", DuplicateLabels));
        }
    }

    public sealed class MechanicalBomTableKnowledge
    {
        internal MechanicalBomTableKnowledge(string id)
        {
            Id = id;
            Rows = new List<MechanicalBomRowKnowledge>();
            Columns = MechanicalBomKnowledgeBuilder.CreateColumns();
            SequenceGaps = new List<int>();
            DuplicateItemNumbers = new List<int>();
            NonEmptyCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            SerialAnnotationGroups = new List<MechanicalBomSerialAnnotationGroupKnowledge>();
        }

        public string Id { get; private set; }
        public IList<MechanicalBomColumnDefinition> Columns { get; private set; }
        public IList<MechanicalBomRowKnowledge> Rows { get; private set; }
        public int? MinimumItemNumber { get; internal set; }
        public int? MaximumItemNumber { get; internal set; }
        public bool SequenceStartsAtOne { get; internal set; }
        public bool SequenceIsContiguous { get; internal set; }
        public IList<int> SequenceGaps { get; private set; }
        public IList<int> DuplicateItemNumbers { get; private set; }
        public int XDataComparableRowCount { get; internal set; }
        public int XDataMatchingRowCount { get; internal set; }
        public int AnnotatedRowCount { get; internal set; }
        public int AnnotationLinkCount { get; internal set; }
        public int PresentAnnotationLinkCount { get; internal set; }
        public IDictionary<string, int> NonEmptyCounts { get; private set; }
        public IList<MechanicalBomSerialAnnotationGroupKnowledge> SerialAnnotationGroups { get; private set; }
        public int GroupedAnnotationCount { get; internal set; }
        public int UngroupedAnnotationCount { get; internal set; }
        public double MinX { get; internal set; }
        public double MinY { get; internal set; }
        public double MaxX { get; internal set; }
        public double MaxY { get; internal set; }

        internal Dictionary<string, object> ToMap()
        {
            var columns = new List<Dictionary<string, object>>();
            foreach (MechanicalBomColumnDefinition column in Columns)
            {
                columns.Add(column.ToMap());
            }
            var rows = new List<Dictionary<string, object>>();
            foreach (MechanicalBomRowKnowledge row in Rows)
            {
                rows.Add(row.ToMap());
            }
            var serialAnnotationGroups = new List<Dictionary<string, object>>();
            foreach (MechanicalBomSerialAnnotationGroupKnowledge group in SerialAnnotationGroups)
            {
                serialAnnotationGroups.Add(group.ToMap());
            }

            return MechanicalBomMaps.Map(
                "id", Id,
                "kind", "mechanical_bill_of_materials",
                "source_method", "pc_mxb_block_attributes",
                "bounds", MechanicalBomMaps.Map(
                    "min", new[] { MinX, MinY },
                    "max", new[] { MaxX, MaxY }),
                "column_count", Columns.Count,
                "row_count", Rows.Count,
                "columns", columns,
                "sequence", MechanicalBomMaps.Map(
                    "minimum", MinimumItemNumber,
                    "maximum", MaximumItemNumber,
                    "starts_at_one", SequenceStartsAtOne,
                    "contiguous", SequenceIsContiguous,
                    "gaps", SequenceGaps,
                    "duplicates", DuplicateItemNumbers),
                "evidence_consistency", MechanicalBomMaps.Map(
                    "th_xuhao_comparable_rows", XDataComparableRowCount,
                    "th_xuhao_matching_rows", XDataMatchingRowCount,
                    "all_comparable_rows_match",
                        XDataComparableRowCount == XDataMatchingRowCount),
                "annotation_summary", MechanicalBomMaps.Map(
                    "annotated_row_count", AnnotatedRowCount,
                    "link_count", AnnotationLinkCount,
                    "present_entity_link_count", PresentAnnotationLinkCount,
                    "serial_group_count", SerialAnnotationGroups.Count,
                    "grouped_annotation_count", GroupedAnnotationCount,
                    "ungrouped_annotation_count", UngroupedAnnotationCount),
                "non_empty_counts", NonEmptyCounts,
                "serial_annotation_groups", serialAnnotationGroups,
                "rows", rows);
        }
    }

    public sealed class MechanicalBomKnowledgeDocument
    {
        internal MechanicalBomKnowledgeDocument(string drawingId)
        {
            DrawingId = drawingId ?? "";
            Tables = new List<MechanicalBomTableKnowledge>();
        }

        public string DrawingId { get; private set; }
        public IList<MechanicalBomTableKnowledge> Tables { get; private set; }

        public int RowCount
        {
            get
            {
                int count = 0;
                foreach (MechanicalBomTableKnowledge table in Tables)
                {
                    count += table.Rows.Count;
                }
                return count;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            var tables = new List<Dictionary<string, object>>();
            foreach (MechanicalBomTableKnowledge table in Tables)
            {
                tables.Add(table.ToMap());
            }

            return MechanicalBomMaps.Map(
                "schema_version", "2",
                "knowledge_type", "mechanical_bill_of_materials",
                "builder", "mechanical_bom_knowledge_builder",
                "builder_version", "3",
                "annotation_source", "PC_BOMXHRELATEDIC",
                "drawing_id", DrawingId,
                "table_count", Tables.Count,
                "row_count", RowCount,
                "tables", tables,
                "limits", new[]
                {
                    "pc_mxb_block_rows_only",
                    "one_bom_table_per_drawing",
                    "raw_values_are_authoritative",
                    "no_line_grid_reconstruction"
                });
        }
    }

    public static class MechanicalBomKnowledgeBuilder
    {
        static readonly MechanicalBomColumnDefinition[] ColumnDefinitions =
        {
            new MechanicalBomColumnDefinition(1, "item_number", "序号", "integer"),
            new MechanicalBomColumnDefinition(2, "part_number", "代号", "string"),
            new MechanicalBomColumnDefinition(3, "name", "名称", "string"),
            new MechanicalBomColumnDefinition(4, "quantity", "数量", "integer_or_notation"),
            new MechanicalBomColumnDefinition(5, "material", "材料", "string"),
            new MechanicalBomColumnDefinition(6, "unit_weight", "单重", "decimal_or_string"),
            new MechanicalBomColumnDefinition(7, "total_weight", "总重", "decimal_or_string"),
            new MechanicalBomColumnDefinition(8, "remark", "备注", "string")
        };

        public static MechanicalBomKnowledgeDocument Build(
            string drawingId,
            IList<MechanicalBomRowObservation> sourceRows)
        {
            return Build(
                drawingId,
                sourceRows,
                new List<MechanicalBomAnnotationObservation>());
        }

        public static MechanicalBomKnowledgeDocument Build(
            string drawingId,
            IList<MechanicalBomRowObservation> sourceRows,
            IList<MechanicalBomAnnotationObservation> sourceAnnotations)
        {
            if (sourceRows == null)
            {
                throw new ArgumentNullException("sourceRows");
            }
            if (sourceAnnotations == null)
            {
                throw new ArgumentNullException("sourceAnnotations");
            }

            var document = new MechanicalBomKnowledgeDocument(drawingId);
            if (sourceRows.Count == 0)
            {
                return document;
            }

            var table = new MechanicalBomTableKnowledge("bom-table-1");
            foreach (MechanicalBomRowObservation source in sourceRows)
            {
                if (source != null)
                {
                    table.Rows.Add(BuildRow(source));
                }
            }
            SortRows(table.Rows);
            for (int i = 0; i < table.Rows.Count; i++)
            {
                table.Rows[i].Id = "bom-row-" + (i + 1).ToString(CultureInfo.InvariantCulture);
            }
            AttachAnnotations(table.Rows, sourceAnnotations);
            BuildSerialAnnotationGroups(table);
            Summarize(table);
            document.Tables.Add(table);
            return document;
        }

        internal static IList<MechanicalBomColumnDefinition> CreateColumns()
        {
            return new List<MechanicalBomColumnDefinition>(ColumnDefinitions);
        }

        static MechanicalBomRowKnowledge BuildRow(MechanicalBomRowObservation source)
        {
            var row = new MechanicalBomRowKnowledge(source);
            var byLabel = new Dictionary<string, MechanicalBomCellObservation>(StringComparer.Ordinal);
            foreach (MechanicalBomCellObservation cell in source.Cells)
            {
                if (cell == null || string.IsNullOrEmpty(cell.Label))
                {
                    continue;
                }
                if (byLabel.ContainsKey(cell.Label))
                {
                    AddUnique(row.DuplicateLabels, cell.Label);
                    continue;
                }
                byLabel[cell.Label] = cell;
            }

            foreach (MechanicalBomColumnDefinition column in ColumnDefinitions)
            {
                MechanicalBomCellObservation cell;
                if (!byLabel.TryGetValue(column.Label, out cell))
                {
                    row.Values[column.Key] = "";
                    row.CellHandles[column.Key] = "";
                    row.CellPositions[column.Key] = new[] { double.NaN, double.NaN };
                    row.MissingColumns.Add(column.Key);
                    continue;
                }

                string raw = cell.RawValue ?? "";
                row.Values[column.Key] = raw;
                row.CellHandles[column.Key] = cell.Handle;
                row.CellPositions[column.Key] = new[] { cell.X, cell.Y };
                object parsed = ParseValue(column.Key, raw);
                if (parsed != null)
                {
                    row.ParsedValues[column.Key] = parsed;
                }
            }

            int itemNumber;
            if (TryPlainInteger(row.Values["item_number"], out itemNumber))
            {
                row.ItemNumber = itemNumber;
            }
            if (!string.IsNullOrWhiteSpace(source.XDataItemNumber))
            {
                row.ItemNumberMatchesXData = string.Equals(
                    row.Values["item_number"].Trim(),
                    source.XDataItemNumber.Trim(),
                    StringComparison.Ordinal);
            }
            return row;
        }

        static void AttachAnnotations(
            IList<MechanicalBomRowKnowledge> rows,
            IList<MechanicalBomAnnotationObservation> annotations)
        {
            var rowsByItemNumber =
                new Dictionary<int, List<MechanicalBomRowKnowledge>>();
            foreach (MechanicalBomRowKnowledge row in rows)
            {
                if (!row.ItemNumber.HasValue)
                {
                    continue;
                }
                List<MechanicalBomRowKnowledge> matchingRows;
                if (!rowsByItemNumber.TryGetValue(row.ItemNumber.Value, out matchingRows))
                {
                    matchingRows = new List<MechanicalBomRowKnowledge>();
                    rowsByItemNumber[row.ItemNumber.Value] = matchingRows;
                }
                matchingRows.Add(row);
            }

            foreach (MechanicalBomAnnotationObservation annotation in annotations)
            {
                if (annotation == null)
                {
                    continue;
                }
                List<MechanicalBomRowKnowledge> matchingRows;
                if (!rowsByItemNumber.TryGetValue(annotation.ItemNumber, out matchingRows))
                {
                    continue;
                }
                foreach (MechanicalBomRowKnowledge row in matchingRows)
                {
                    row.Annotations.Add(annotation);
                }
            }

            foreach (MechanicalBomRowKnowledge row in rows)
            {
                var list = row.Annotations as List<MechanicalBomAnnotationObservation>;
                if (list != null)
                {
                    list.Sort(CompareAnnotations);
                }
            }
        }

        static int CompareAnnotations(
            MechanicalBomAnnotationObservation left,
            MechanicalBomAnnotationObservation right)
        {
            int handle = string.Compare(
                left.XuhaoHandle,
                right.XuhaoHandle,
                StringComparison.OrdinalIgnoreCase);
            return handle != 0
                ? handle
                : string.Compare(
                    left.AssociationRecordHandle,
                    right.AssociationRecordHandle,
                    StringComparison.OrdinalIgnoreCase);
        }

        static void BuildSerialAnnotationGroups(MechanicalBomTableKnowledge table)
        {
            var byHandle = new Dictionary<string, MechanicalBomAnnotationObservation>(
                StringComparer.OrdinalIgnoreCase);
            foreach (MechanicalBomRowKnowledge row in table.Rows)
            {
                foreach (MechanicalBomAnnotationObservation annotation in row.Annotations)
                {
                    if (!annotation.EntityPresent)
                    {
                        continue;
                    }
                    if (!string.IsNullOrWhiteSpace(annotation.XuhaoHandle)
                        && !byHandle.ContainsKey(annotation.XuhaoHandle))
                    {
                        byHandle[annotation.XuhaoHandle] = annotation;
                    }
                }
            }

            var candidates = byHandle.Values
                .Where(annotation => HasPlanarPosition(annotation.NumberPosition))
                .OrderBy(annotation => annotation.XuhaoHandle, StringComparer.OrdinalIgnoreCase)
                .ToList();
            double serialConnectionLimit = EstimateSerialConnectionLimit(candidates);
            int attachedPresent = byHandle.Count;
            var links = new List<MechanicalBomSerialAnnotationLinkKnowledge>();
            foreach (MechanicalBomAnnotationObservation source in candidates)
            {
                MechanicalBomSerialAnnotationLinkKnowledge best = null;
                if (HasPlanarPosition(source.PointingPosition))
                {
                    foreach (MechanicalBomAnnotationObservation target in candidates)
                    {
                        if (ReferenceEquals(source, target))
                        {
                            continue;
                        }
                        MechanicalBomSerialAnnotationLinkKnowledge candidate =
                            TryCreateInternalSerialLink(source, target, serialConnectionLimit);
                        if (candidate == null)
                        {
                            continue;
                        }
                        if (best == null
                            || candidate.PointingResidual < best.PointingResidual
                            || (Math.Abs(candidate.PointingResidual - best.PointingResidual) <= 1e-9
                                && candidate.LineResidual < best.LineResidual))
                        {
                            best = candidate;
                        }
                    }
                }
                if (best != null)
                {
                    links.Add(best);
                }
            }

            var adjacency = new Dictionary<MechanicalBomAnnotationObservation,
                List<MechanicalBomAnnotationObservation>>();
            foreach (MechanicalBomAnnotationObservation candidate in candidates)
            {
                adjacency[candidate] = new List<MechanicalBomAnnotationObservation>();
            }
            foreach (MechanicalBomSerialAnnotationLinkKnowledge link in links)
            {
                adjacency[link.Source].Add(link.Target);
                adjacency[link.Target].Add(link.Source);
            }

            var visited = new HashSet<MechanicalBomAnnotationObservation>();
            var components = new List<List<MechanicalBomAnnotationObservation>>();
            foreach (MechanicalBomAnnotationObservation candidate in candidates)
            {
                if (visited.Contains(candidate))
                {
                    continue;
                }
                var component = new List<MechanicalBomAnnotationObservation>();
                var queue = new Queue<MechanicalBomAnnotationObservation>();
                queue.Enqueue(candidate);
                visited.Add(candidate);
                while (queue.Count > 0)
                {
                    MechanicalBomAnnotationObservation current = queue.Dequeue();
                    component.Add(current);
                    foreach (MechanicalBomAnnotationObservation next in adjacency[current])
                    {
                        if (visited.Add(next))
                        {
                            queue.Enqueue(next);
                        }
                    }
                }
                components.Add(component);
            }

            components.Sort((left, right) => CompareAnnotations(
                left.OrderBy(item => item.ItemNumber)
                    .ThenBy(item => item.XuhaoHandle, StringComparer.OrdinalIgnoreCase).First(),
                right.OrderBy(item => item.ItemNumber)
                    .ThenBy(item => item.XuhaoHandle, StringComparer.OrdinalIgnoreCase).First()));
            int groupIndex = 0;
            foreach (List<MechanicalBomAnnotationObservation> component in components)
            {
                groupIndex++;
                var group = new MechanicalBomSerialAnnotationGroupKnowledge(
                    "serial-annotation-group-" + groupIndex.ToString("D3", CultureInfo.InvariantCulture));
                foreach (MechanicalBomAnnotationObservation member in component)
                {
                    group.Members.Add(member);
                }
                foreach (MechanicalBomSerialAnnotationLinkKnowledge link in links)
                {
                    if (component.Contains(link.Source) && component.Contains(link.Target))
                    {
                        group.InternalLinks.Add(link);
                    }
                }
                foreach (MechanicalBomAnnotationObservation member in component)
                {
                    bool isInternalSource = group.InternalLinks.Any(link => ReferenceEquals(link.Source, member));
                    if (HasPlanarPosition(member.PointingPosition) && !isInternalSource)
                    {
                        group.ExternalTargetMembers.Add(member);
                    }
                }
                OrderGroupMembers(group);
                table.SerialAnnotationGroups.Add(group);
                table.GroupedAnnotationCount += component.Count;
            }
            table.UngroupedAnnotationCount = Math.Max(0, attachedPresent - table.GroupedAnnotationCount);
        }

        static MechanicalBomSerialAnnotationLinkKnowledge TryCreateInternalSerialLink(
            MechanicalBomAnnotationObservation source,
            MechanicalBomAnnotationObservation target,
            double serialConnectionLimit)
        {
            double ax = source.NumberPosition[0];
            double ay = source.NumberPosition[1];
            double bx = target.NumberPosition[0];
            double by = target.NumberPosition[1];
            double px = source.PointingPosition[0];
            double py = source.PointingPosition[1];
            double dx = bx - ax;
            double dy = by - ay;
            double centerDistanceSquared = dx * dx + dy * dy;
            if (centerDistanceSquared <= 1e-12)
            {
                return null;
            }
            double centerDistance = Math.Sqrt(centerDistanceSquared);
            if (centerDistance > serialConnectionLimit)
            {
                return null;
            }
            double projection = ((px - ax) * dx + (py - ay) * dy) / centerDistanceSquared;
            if (projection < 0.25 || projection > 0.75)
            {
                return null;
            }
            double projectedX = ax + projection * dx;
            double projectedY = ay + projection * dy;
            double lineResidual = Distance(px, py, projectedX, projectedY);
            double fromSource = Distance(px, py, ax, ay);
            double toTarget = Distance(px, py, bx, by);
            if (lineResidual > Math.Max(1e-6, centerDistance * 0.08)
                || fromSource < centerDistance * 0.20
                || fromSource > centerDistance * 0.75
                || toTarget < centerDistance * 0.20
                || toTarget > centerDistance * 0.75)
            {
                return null;
            }
            return new MechanicalBomSerialAnnotationLinkKnowledge(
                source,
                target,
                centerDistance,
                toTarget,
                lineResidual,
                projection);
        }

        static double EstimateSerialConnectionLimit(
            IList<MechanicalBomAnnotationObservation> candidates)
        {
            if (candidates.Count < 2)
            {
                return double.PositiveInfinity;
            }

            var nearestDistances = new List<double>();
            foreach (MechanicalBomAnnotationObservation source in candidates)
            {
                double nearest = double.PositiveInfinity;
                foreach (MechanicalBomAnnotationObservation target in candidates)
                {
                    if (ReferenceEquals(source, target))
                    {
                        continue;
                    }
                    double distance = Distance(
                        source.NumberPosition[0],
                        source.NumberPosition[1],
                        target.NumberPosition[0],
                        target.NumberPosition[1]);
                    if (distance > 1e-6 && distance < nearest)
                    {
                        nearest = distance;
                    }
                }
                if (!double.IsInfinity(nearest))
                {
                    nearestDistances.Add(nearest);
                }
            }
            if (nearestDistances.Count == 0)
            {
                return double.PositiveInfinity;
            }

            nearestDistances.Sort();
            int lowerQuartileIndex = Math.Min(
                nearestDistances.Count - 1,
                (int)Math.Floor(nearestDistances.Count * 0.25));
            // Consecutive balloons are local drawing symbols.  A remote leader
            // may accidentally cross the segment between two unrelated balloon
            // centres, so the ratio test below is insufficient on its own.  The
            // lower-quartile nearest-neighbour distance supplies a drawing-scale
            // estimate without hard-coding one paper-space size.
            return Math.Max(1e-6, nearestDistances[lowerQuartileIndex] * 4.0);
        }

        static void OrderGroupMembers(MechanicalBomSerialAnnotationGroupKnowledge group)
        {
            var ordered = new List<MechanicalBomAnnotationObservation>();
            var roots = group.ExternalTargetMembers
                .OrderBy(member => member.ItemNumber)
                .ThenBy(member => member.XuhaoHandle, StringComparer.OrdinalIgnoreCase)
                .ToList();
            foreach (MechanicalBomAnnotationObservation root in roots)
            {
                AppendGroupTree(root, group.InternalLinks, ordered);
            }
            foreach (MechanicalBomAnnotationObservation member in group.Members
                .OrderBy(item => item.ItemNumber)
                .ThenBy(item => item.XuhaoHandle, StringComparer.OrdinalIgnoreCase))
            {
                AppendGroupTree(member, group.InternalLinks, ordered);
            }
            foreach (MechanicalBomAnnotationObservation member in ordered)
            {
                group.OrderedMembers.Add(member);
            }
        }

        static void AppendGroupTree(
            MechanicalBomAnnotationObservation parent,
            IList<MechanicalBomSerialAnnotationLinkKnowledge> links,
            IList<MechanicalBomAnnotationObservation> ordered)
        {
            if (ordered.Contains(parent))
            {
                return;
            }
            ordered.Add(parent);
            foreach (MechanicalBomSerialAnnotationLinkKnowledge link in links
                .Where(candidate => ReferenceEquals(candidate.Target, parent))
                .OrderBy(candidate => candidate.Source.ItemNumber)
                .ThenBy(candidate => candidate.Source.XuhaoHandle, StringComparer.OrdinalIgnoreCase))
            {
                AppendGroupTree(link.Source, links, ordered);
            }
        }

        static bool HasPlanarPosition(double[] value)
        {
            return value != null
                && value.Length >= 2
                && !double.IsNaN(value[0])
                && !double.IsInfinity(value[0])
                && !double.IsNaN(value[1])
                && !double.IsInfinity(value[1]);
        }

        static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x2 - x1;
            double dy = y2 - y1;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static object ParseValue(string key, string raw)
        {
            string value = (raw ?? "").Trim();
            if (value.Length == 0)
            {
                return null;
            }

            int number;
            if (key == "item_number" && TryPlainInteger(value, out number))
            {
                return MechanicalBomMaps.Map("kind", "integer", "value", number);
            }
            if (key == "quantity")
            {
                if (TryPlainInteger(value, out number))
                {
                    return MechanicalBomMaps.Map(
                        "kind", "integer",
                        "value", number,
                        "notation", "plain");
                }
                if (TryParenthesizedInteger(value, out number))
                {
                    return MechanicalBomMaps.Map(
                        "kind", "integer",
                        "value", number,
                        "notation", "parenthesized");
                }
            }
            if (key == "unit_weight" || key == "total_weight")
            {
                decimal decimalValue;
                if (decimal.TryParse(
                    value,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out decimalValue))
                {
                    return MechanicalBomMaps.Map(
                        "kind", "decimal",
                        "value", decimalValue);
                }
            }
            return null;
        }

        static void SortRows(IList<MechanicalBomRowKnowledge> rows)
        {
            var list = rows as List<MechanicalBomRowKnowledge>;
            if (list == null)
            {
                return;
            }
            list.Sort(CompareRows);
        }

        static int CompareRows(MechanicalBomRowKnowledge left, MechanicalBomRowKnowledge right)
        {
            if (left.ItemNumber.HasValue && right.ItemNumber.HasValue)
            {
                int item = left.ItemNumber.Value.CompareTo(right.ItemNumber.Value);
                if (item != 0)
                {
                    return item;
                }
            }
            else if (left.ItemNumber.HasValue)
            {
                return -1;
            }
            else if (right.ItemNumber.HasValue)
            {
                return 1;
            }

            int y = left.Source.PositionY.CompareTo(right.Source.PositionY);
            return y != 0
                ? y
                : string.Compare(left.Source.Handle, right.Source.Handle, StringComparison.Ordinal);
        }

        static void Summarize(MechanicalBomTableKnowledge table)
        {
            var counts = new Dictionary<int, int>();
            bool firstBounds = true;
            foreach (MechanicalBomRowKnowledge row in table.Rows)
            {
                if (row.ItemNumber.HasValue)
                {
                    int item = row.ItemNumber.Value;
                    counts[item] = counts.ContainsKey(item) ? counts[item] + 1 : 1;
                    table.MinimumItemNumber = !table.MinimumItemNumber.HasValue
                        ? item
                        : Math.Min(table.MinimumItemNumber.Value, item);
                    table.MaximumItemNumber = !table.MaximumItemNumber.HasValue
                        ? item
                        : Math.Max(table.MaximumItemNumber.Value, item);
                }

                if (row.ItemNumberMatchesXData.HasValue)
                {
                    table.XDataComparableRowCount++;
                    if (row.ItemNumberMatchesXData.Value)
                    {
                        table.XDataMatchingRowCount++;
                    }
                }

                if (row.Annotations.Count > 0)
                {
                    table.AnnotatedRowCount++;
                    table.AnnotationLinkCount += row.Annotations.Count;
                    foreach (MechanicalBomAnnotationObservation annotation in row.Annotations)
                    {
                        if (annotation.EntityPresent)
                        {
                            table.PresentAnnotationLinkCount++;
                        }
                    }
                }

                foreach (MechanicalBomColumnDefinition column in table.Columns)
                {
                    if (!table.NonEmptyCounts.ContainsKey(column.Key))
                    {
                        table.NonEmptyCounts[column.Key] = 0;
                    }
                    string value;
                    if (row.Values.TryGetValue(column.Key, out value)
                        && !string.IsNullOrWhiteSpace(value))
                    {
                        table.NonEmptyCounts[column.Key]++;
                    }
                }

                if (firstBounds)
                {
                    table.MinX = row.Source.MinX;
                    table.MinY = row.Source.MinY;
                    table.MaxX = row.Source.MaxX;
                    table.MaxY = row.Source.MaxY;
                    firstBounds = false;
                }
                else
                {
                    table.MinX = Math.Min(table.MinX, row.Source.MinX);
                    table.MinY = Math.Min(table.MinY, row.Source.MinY);
                    table.MaxX = Math.Max(table.MaxX, row.Source.MaxX);
                    table.MaxY = Math.Max(table.MaxY, row.Source.MaxY);
                }
            }

            foreach (KeyValuePair<int, int> pair in counts)
            {
                if (pair.Value > 1)
                {
                    table.DuplicateItemNumbers.Add(pair.Key);
                }
            }
            if (table.MinimumItemNumber.HasValue && table.MaximumItemNumber.HasValue)
            {
                for (int item = table.MinimumItemNumber.Value;
                    item <= table.MaximumItemNumber.Value;
                    item++)
                {
                    if (!counts.ContainsKey(item))
                    {
                        table.SequenceGaps.Add(item);
                    }
                }
            }
            table.SequenceStartsAtOne = table.MinimumItemNumber == 1;
            table.SequenceIsContiguous = table.Rows.Count > 0
                && table.SequenceStartsAtOne
                && table.SequenceGaps.Count == 0
                && table.DuplicateItemNumbers.Count == 0
                && counts.Count == table.Rows.Count;
        }

        static bool TryPlainInteger(string value, out int number)
        {
            return int.TryParse(
                (value ?? "").Trim(),
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out number);
        }

        static bool TryParenthesizedInteger(string value, out int number)
        {
            number = 0;
            string trimmed = (value ?? "").Trim();
            if (trimmed.Length < 3
                || trimmed[0] != '('
                || trimmed[trimmed.Length - 1] != ')')
            {
                return false;
            }
            return TryPlainInteger(trimmed.Substring(1, trimmed.Length - 2), out number);
        }

        static void AddUnique(IList<string> values, string value)
        {
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.Ordinal))
                {
                    return;
                }
            }
            values.Add(value);
        }
    }

    internal static class MechanicalBomMaps
    {
        public static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2)
            {
                result[(string)pairs[i]] = pairs[i + 1];
            }
            return result;
        }
    }
}
