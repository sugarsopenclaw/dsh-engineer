using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class InstancePoint3Observation
    {
        public InstancePoint3Observation(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double X { get; private set; }
        public double Y { get; private set; }
        public double Z { get; private set; }

        public double[] ToArray()
        {
            return new[] { X, Y, Z };
        }
    }

    /// <summary>
    /// Host-independent affine transform. Points are column vectors and composition is
    /// parent.Multiply(local), so a point is transformed by local first, then parent.
    /// </summary>
    public sealed class InstanceAffineTransformObservation
    {
        readonly double[] values;

        public InstanceAffineTransformObservation(
            double m00, double m01, double m02, double m03,
            double m10, double m11, double m12, double m13,
            double m20, double m21, double m22, double m23)
        {
            values = new[]
            {
                m00, m01, m02, m03,
                m10, m11, m12, m13,
                m20, m21, m22, m23
            };
        }

        public static InstanceAffineTransformObservation Identity
        {
            get
            {
                return new InstanceAffineTransformObservation(
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0);
            }
        }

        public static InstanceAffineTransformObservation Translation(
            double x,
            double y,
            double z)
        {
            return new InstanceAffineTransformObservation(
                1, 0, 0, x,
                0, 1, 0, y,
                0, 0, 1, z);
        }

        public double this[int row, int column]
        {
            get { return values[row * 4 + column]; }
        }

        public double Determinant3d
        {
            get
            {
                return this[0, 0] * (this[1, 1] * this[2, 2] - this[1, 2] * this[2, 1])
                    - this[0, 1] * (this[1, 0] * this[2, 2] - this[1, 2] * this[2, 0])
                    + this[0, 2] * (this[1, 0] * this[2, 1] - this[1, 1] * this[2, 0]);
            }
        }

        public double Determinant2d
        {
            get { return this[0, 0] * this[1, 1] - this[0, 1] * this[1, 0]; }
        }

        public bool IsMirrored
        {
            get { return Determinant2d < 0; }
        }

        public InstancePoint3Observation Transform(InstancePoint3Observation point)
        {
            if (point == null)
            {
                return null;
            }
            return new InstancePoint3Observation(
                this[0, 0] * point.X + this[0, 1] * point.Y
                    + this[0, 2] * point.Z + this[0, 3],
                this[1, 0] * point.X + this[1, 1] * point.Y
                    + this[1, 2] * point.Z + this[1, 3],
                this[2, 0] * point.X + this[2, 1] * point.Y
                    + this[2, 2] * point.Z + this[2, 3]);
        }

        public InstanceAffineTransformObservation Multiply(
            InstanceAffineTransformObservation local)
        {
            if (local == null)
            {
                return this;
            }
            double[,] result = new double[3, 4];
            for (int row = 0; row < 3; row++)
            {
                for (int column = 0; column < 3; column++)
                {
                    result[row, column] = this[row, 0] * local[0, column]
                        + this[row, 1] * local[1, column]
                        + this[row, 2] * local[2, column];
                }
                result[row, 3] = this[row, 0] * local[0, 3]
                    + this[row, 1] * local[1, 3]
                    + this[row, 2] * local[2, 3]
                    + this[row, 3];
            }
            return new InstanceAffineTransformObservation(
                result[0, 0], result[0, 1], result[0, 2], result[0, 3],
                result[1, 0], result[1, 1], result[1, 2], result[1, 3],
                result[2, 0], result[2, 1], result[2, 2], result[2, 3]);
        }

        public double[] ToArray()
        {
            return (double[])values.Clone();
        }
    }

    public sealed class InstanceColorObservation
    {
        public InstanceColorObservation(
            string mode,
            string name,
            int? index,
            int? red,
            int? green,
            int? blue)
        {
            Mode = string.IsNullOrEmpty(mode) ? "unknown" : mode;
            Name = name ?? "";
            HasIndex = index.HasValue;
            Index = index.HasValue ? index.Value : 0;
            HasRgb = red.HasValue && green.HasValue && blue.HasValue;
            Red = red.HasValue ? red.Value : 0;
            Green = green.HasValue ? green.Value : 0;
            Blue = blue.HasValue ? blue.Value : 0;
        }

        public string Mode { get; private set; }
        public string Name { get; private set; }
        public bool HasIndex { get; private set; }
        public int Index { get; private set; }
        public bool HasRgb { get; private set; }
        public int Red { get; private set; }
        public int Green { get; private set; }
        public int Blue { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return InstanceMaps.Map(
                "mode", Mode,
                "name", Name,
                "index", HasIndex ? (object)Index : null,
                "rgb", HasRgb ? (object)new[] { Red, Green, Blue } : null);
        }
    }

    public sealed class InstanceLayerObservation
    {
        public InstanceLayerObservation(
            string name,
            InstanceColorObservation color,
            string linetype,
            int? lineweight,
            bool isOff,
            bool isFrozen)
        {
            Name = name ?? "";
            Color = color ?? new InstanceColorObservation("unknown", "", null, null, null, null);
            Linetype = linetype ?? "";
            HasLineweight = lineweight.HasValue;
            Lineweight = lineweight.HasValue ? lineweight.Value : 0;
            IsOff = isOff;
            IsFrozen = isFrozen;
        }

        public string Name { get; private set; }
        public InstanceColorObservation Color { get; private set; }
        public string Linetype { get; private set; }
        public bool HasLineweight { get; private set; }
        public int Lineweight { get; private set; }
        public bool IsOff { get; private set; }
        public bool IsFrozen { get; private set; }
    }

    public sealed class InstanceEntityObservation
    {
        readonly List<InstancePoint3Observation> localPath;

        public InstanceEntityObservation(
            string handle,
            string runtimeClass,
            string managedType,
            string geometryKind,
            string layer,
            bool visible)
        {
            Handle = handle ?? "";
            RuntimeClass = runtimeClass ?? "";
            ManagedType = managedType ?? "";
            GeometryKind = geometryKind ?? "";
            Layer = layer ?? "";
            Visible = visible;
            RawColor = new InstanceColorObservation("by_layer", "ByLayer", 256, null, null, null);
            RawLinetypeMode = "by_layer";
            RawLinetype = "ByLayer";
            RawLineweightMode = "by_layer";
            LocalTransform = InstanceAffineTransformObservation.Identity;
            RowCount = 1;
            ColumnCount = 1;
            GeometryQuality = "unsupported_geometry";
            localPath = new List<InstancePoint3Observation>();
        }

        public string Handle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string ManagedType { get; private set; }
        public string GeometryKind { get; private set; }
        public string Layer { get; private set; }
        public bool Visible { get; private set; }
        public InstanceColorObservation RawColor { get; private set; }
        public string RawLinetypeMode { get; private set; }
        public string RawLinetype { get; private set; }
        public string RawLineweightMode { get; private set; }
        public bool HasRawLineweight { get; private set; }
        public int RawLineweight { get; private set; }
        public bool IsCurve { get; private set; }
        public bool IsClosed { get; private set; }
        public string GeometryQuality { get; private set; }
        public IList<InstancePoint3Observation> LocalPath { get { return localPath.AsReadOnly(); } }
        public bool IsBlockReference { get; private set; }
        public string TargetDefinitionHandle { get; private set; }
        public string TargetDefinitionName { get; private set; }
        public string AuthoringDefinitionHandle { get; private set; }
        public InstanceAffineTransformObservation LocalTransform { get; private set; }
        public int RowCount { get; private set; }
        public int ColumnCount { get; private set; }
        public double RowSpacing { get; private set; }
        public double ColumnSpacing { get; private set; }
        public bool IsDynamic { get; private set; }
        public bool IsExternalReference { get; private set; }

        public InstanceEntityObservation SetRawStyle(
            InstanceColorObservation color,
            string linetypeMode,
            string linetype,
            string lineweightMode,
            int? lineweight)
        {
            RawColor = color ?? RawColor;
            RawLinetypeMode = string.IsNullOrEmpty(linetypeMode) ? "unknown" : linetypeMode;
            RawLinetype = linetype ?? "";
            RawLineweightMode = string.IsNullOrEmpty(lineweightMode)
                ? "unknown"
                : lineweightMode;
            HasRawLineweight = lineweight.HasValue;
            RawLineweight = lineweight.HasValue ? lineweight.Value : 0;
            return this;
        }

        public InstanceEntityObservation SetPath(
            IList<InstancePoint3Observation> points,
            bool closed,
            string quality)
        {
            localPath.Clear();
            if (points != null)
            {
                foreach (InstancePoint3Observation point in points)
                {
                    if (point != null && Finite(point.X) && Finite(point.Y) && Finite(point.Z))
                    {
                        localPath.Add(point);
                    }
                }
            }
            IsCurve = localPath.Count >= 2;
            IsClosed = closed;
            GeometryQuality = quality ?? (IsCurve ? "normalized_path" : "unsupported_geometry");
            return this;
        }

        public InstanceEntityObservation SetBlockReference(
            string targetDefinitionHandle,
            string targetDefinitionName,
            string authoringDefinitionHandle,
            InstanceAffineTransformObservation localTransform,
            int rowCount,
            int columnCount,
            double rowSpacing,
            double columnSpacing,
            bool isDynamic,
            bool isExternalReference)
        {
            IsBlockReference = true;
            TargetDefinitionHandle = targetDefinitionHandle ?? "";
            TargetDefinitionName = targetDefinitionName ?? "";
            AuthoringDefinitionHandle = authoringDefinitionHandle ?? "";
            LocalTransform = localTransform ?? InstanceAffineTransformObservation.Identity;
            RowCount = Math.Max(1, rowCount);
            ColumnCount = Math.Max(1, columnCount);
            RowSpacing = rowSpacing;
            ColumnSpacing = columnSpacing;
            IsDynamic = isDynamic;
            IsExternalReference = isExternalReference;
            GeometryQuality = "block_reference_transform";
            return this;
        }

        static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    public sealed class InstanceDefinitionObservation
    {
        readonly List<InstanceEntityObservation> entities;

        public InstanceDefinitionObservation(
            string handle,
            string name,
            string ownerScope,
            bool isRootSpace,
            bool isExternalReference,
            bool isAnonymous)
        {
            Handle = handle ?? "";
            Name = name ?? "";
            OwnerScope = ownerScope ?? "";
            IsRootSpace = isRootSpace;
            IsExternalReference = isExternalReference;
            IsAnonymous = isAnonymous;
            entities = new List<InstanceEntityObservation>();
        }

        public string Handle { get; private set; }
        public string Name { get; private set; }
        public string OwnerScope { get; private set; }
        public bool IsRootSpace { get; private set; }
        public bool IsExternalReference { get; private set; }
        public bool IsAnonymous { get; private set; }
        public IList<InstanceEntityObservation> Entities { get { return entities.AsReadOnly(); } }

        public InstanceDefinitionObservation AddEntity(InstanceEntityObservation entity)
        {
            if (entity != null)
            {
                entities.Add(entity);
            }
            return this;
        }
    }

    public sealed class InstanceDrawingObservation
    {
        readonly List<InstanceDefinitionObservation> definitions;
        readonly List<InstanceLayerObservation> layers;

        public InstanceDrawingObservation(string drawingId)
        {
            DrawingId = drawingId ?? "";
            definitions = new List<InstanceDefinitionObservation>();
            layers = new List<InstanceLayerObservation>();
        }

        public string DrawingId { get; private set; }
        public IList<InstanceDefinitionObservation> Definitions { get { return definitions.AsReadOnly(); } }
        public IList<InstanceLayerObservation> Layers { get { return layers.AsReadOnly(); } }

        public InstanceDrawingObservation AddDefinition(InstanceDefinitionObservation definition)
        {
            if (definition != null)
            {
                definitions.Add(definition);
            }
            return this;
        }

        public InstanceDrawingObservation AddLayer(InstanceLayerObservation layer)
        {
            if (layer != null)
            {
                layers.Add(layer);
            }
            return this;
        }
    }

    public sealed class BlockInstanceAnalysisConfig
    {
        public BlockInstanceAnalysisConfig()
        {
            MaxNestingDepth = 32;
            MaxOccurrenceCount = 500000;
            EmitNonCurveOccurrences = true;
        }

        public int MaxNestingDepth { get; set; }
        public int MaxOccurrenceCount { get; set; }
        public bool EmitNonCurveOccurrences { get; set; }
    }

    public sealed class InstanceEffectiveStyleRecord
    {
        internal InstanceEffectiveStyleRecord(
            string layer,
            InstanceColorObservation color,
            string colorSource,
            string linetype,
            string linetypeSource,
            int? lineweight,
            string lineweightSource,
            bool layerSuppressed)
        {
            Layer = layer ?? "";
            Color = color ?? new InstanceColorObservation("unknown", "", null, null, null, null);
            ColorSource = colorSource ?? "";
            Linetype = linetype ?? "";
            LinetypeSource = linetypeSource ?? "";
            HasLineweight = lineweight.HasValue;
            Lineweight = lineweight.HasValue ? lineweight.Value : 0;
            LineweightSource = lineweightSource ?? "";
            LayerSuppressed = layerSuppressed;
        }

        public string Layer { get; private set; }
        public InstanceColorObservation Color { get; private set; }
        public string ColorSource { get; private set; }
        public string Linetype { get; private set; }
        public string LinetypeSource { get; private set; }
        public bool HasLineweight { get; private set; }
        public int Lineweight { get; private set; }
        public string LineweightSource { get; private set; }
        public bool LayerSuppressed { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return InstanceMaps.Map(
                "layer", Layer,
                "color", Color.ToMap(),
                "color_source", ColorSource,
                "linetype", Linetype,
                "linetype_source", LinetypeSource,
                "lineweight", HasLineweight ? (object)Lineweight : null,
                "lineweight_source", LineweightSource,
                "layer_suppressed", LayerSuppressed);
        }
    }

    public sealed class InstanceOccurrenceRecord
    {
        readonly List<string> instancePath;
        readonly List<InstancePoint3Observation> worldPath;

        internal InstanceOccurrenceRecord(
            string id,
            string rootDefinitionHandle,
            string rootDefinitionName,
            string sourceDefinitionHandle,
            string sourceDefinitionName,
            InstanceEntityObservation source,
            IList<string> path,
            int nestingDepth,
            int row,
            int column,
            InstanceAffineTransformObservation transform,
            InstanceEffectiveStyleRecord style,
            string semanticRole,
            string status)
        {
            Id = id ?? "";
            RootDefinitionHandle = rootDefinitionHandle ?? "";
            RootDefinitionName = rootDefinitionName ?? "";
            SourceDefinitionHandle = sourceDefinitionHandle ?? "";
            SourceDefinitionName = sourceDefinitionName ?? "";
            SourceHandle = source == null ? "" : source.Handle;
            RuntimeClass = source == null ? "" : source.RuntimeClass;
            ManagedType = source == null ? "" : source.ManagedType;
            GeometryKind = source == null ? "" : source.GeometryKind;
            IsBlockReference = source != null && source.IsBlockReference;
            TargetDefinitionHandle = source == null ? "" : source.TargetDefinitionHandle;
            TargetDefinitionName = source == null ? "" : source.TargetDefinitionName;
            IsDynamicBlock = source != null && source.IsDynamic;
            IsExternalReference = source != null && source.IsExternalReference;
            NestingDepth = nestingDepth;
            Row = row;
            Column = column;
            WorldTransform = transform ?? InstanceAffineTransformObservation.Identity;
            EffectiveStyle = style;
            SemanticRole = string.IsNullOrEmpty(semanticRole) ? "unclassified" : semanticRole;
            Status = status ?? "computed";
            GeometryQuality = source == null ? "unsupported_geometry" : source.GeometryQuality;
            Visible = source != null && source.Visible && style != null && !style.LayerSuppressed;
            IsClosed = source != null && source.IsClosed;
            instancePath = path == null ? new List<string>() : new List<string>(path);
            worldPath = new List<InstancePoint3Observation>();
            if (source != null && source.IsCurve)
            {
                foreach (InstancePoint3Observation point in source.LocalPath)
                {
                    InstancePoint3Observation transformed = WorldTransform.Transform(point);
                    if (transformed != null)
                    {
                        worldPath.Add(transformed);
                    }
                }
            }
            InitializeBounds();
        }

        public string Id { get; private set; }
        public string RootDefinitionHandle { get; private set; }
        public string RootDefinitionName { get; private set; }
        public string SourceDefinitionHandle { get; private set; }
        public string SourceDefinitionName { get; private set; }
        public string SourceHandle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string ManagedType { get; private set; }
        public string GeometryKind { get; private set; }
        public bool IsBlockReference { get; private set; }
        public string TargetDefinitionHandle { get; private set; }
        public string TargetDefinitionName { get; private set; }
        public bool IsDynamicBlock { get; private set; }
        public bool IsExternalReference { get; private set; }
        public int NestingDepth { get; private set; }
        public int Row { get; private set; }
        public int Column { get; private set; }
        public InstanceAffineTransformObservation WorldTransform { get; private set; }
        public InstanceEffectiveStyleRecord EffectiveStyle { get; private set; }
        public string SemanticRole { get; private set; }
        public string Status { get; private set; }
        public string GeometryQuality { get; private set; }
        public bool Visible { get; private set; }
        public bool IsClosed { get; private set; }
        public IList<string> InstancePath { get { return instancePath.AsReadOnly(); } }
        public IList<InstancePoint3Observation> WorldPath { get { return worldPath.AsReadOnly(); } }
        public bool HasWorldPath { get { return worldPath.Count >= 2; } }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            var points = new List<double[]>();
            foreach (InstancePoint3Observation point in worldPath)
            {
                points.Add(point.ToArray());
            }
            return InstanceMaps.Map(
                "occurrence_id", Id,
                "root_definition_handle", RootDefinitionHandle,
                "root_definition_name", RootDefinitionName,
                "source_definition_handle", SourceDefinitionHandle,
                "source_definition_name", SourceDefinitionName,
                "source_handle", SourceHandle,
                "runtime_class", RuntimeClass,
                "managed_type", ManagedType,
                "geometry_kind", GeometryKind,
                "is_block_reference", IsBlockReference,
                "target_definition_handle", IsBlockReference ? (object)TargetDefinitionHandle : null,
                "target_definition_name", IsBlockReference ? (object)TargetDefinitionName : null,
                "dynamic_block", IsDynamicBlock,
                "external_reference", IsExternalReference,
                "instance_path", new List<string>(instancePath),
                "nesting_depth", NestingDepth,
                "minsert_row", Row,
                "minsert_column", Column,
                "world_transform", WorldTransform.ToArray(),
                "planar_determinant", WorldTransform.Determinant2d,
                "mirrored", WorldTransform.IsMirrored,
                "effective_style", EffectiveStyle == null ? null : EffectiveStyle.ToMap(),
                "semantic_role", SemanticRole,
                "visible", Visible,
                "closed", IsClosed,
                "world_path", points,
                "bounds", HasBounds ? (object)new[] { MinX, MinY, MaxX, MaxY } : null,
                "geometry_quality", GeometryQuality,
                "status", Status);
        }

        void InitializeBounds()
        {
            if (worldPath.Count == 0)
            {
                return;
            }
            MinX = MaxX = worldPath[0].X;
            MinY = MaxY = worldPath[0].Y;
            foreach (InstancePoint3Observation point in worldPath)
            {
                MinX = Math.Min(MinX, point.X);
                MinY = Math.Min(MinY, point.Y);
                MaxX = Math.Max(MaxX, point.X);
                MaxY = Math.Max(MaxY, point.Y);
            }
            HasBounds = true;
        }
    }

    public sealed class BlockInstanceDiagnosticRecord
    {
        internal BlockInstanceDiagnosticRecord(
            string code,
            string status,
            string occurrenceId,
            string sourceHandle,
            string message)
        {
            Code = code ?? "";
            Status = status ?? "ambiguous";
            OccurrenceId = occurrenceId ?? "";
            SourceHandle = sourceHandle ?? "";
            Message = message ?? "";
        }

        public string Code { get; private set; }
        public string Status { get; private set; }
        public string OccurrenceId { get; private set; }
        public string SourceHandle { get; private set; }
        public string Message { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return InstanceMaps.Map(
                "code", Code,
                "status", Status,
                "occurrence_id", OccurrenceId,
                "source_handle", SourceHandle,
                "message", Message);
        }
    }

    public sealed class BlockInstanceCoordinateDocument
    {
        readonly List<InstanceOccurrenceRecord> occurrences;
        readonly List<BlockInstanceDiagnosticRecord> diagnostics;
        readonly Dictionary<string, int> geometryQualityCounts;
        readonly Dictionary<string, int> roleCounts;

        internal BlockInstanceCoordinateDocument(
            string drawingId,
            int definitionCount,
            int rootCount,
            IList<InstanceOccurrenceRecord> occurrenceValues,
            IList<BlockInstanceDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            DefinitionCount = definitionCount;
            RootSpaceCount = rootCount;
            occurrences = occurrenceValues == null
                ? new List<InstanceOccurrenceRecord>()
                : new List<InstanceOccurrenceRecord>(occurrenceValues);
            diagnostics = diagnosticValues == null
                ? new List<BlockInstanceDiagnosticRecord>()
                : new List<BlockInstanceDiagnosticRecord>(diagnosticValues);
            geometryQualityCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            roleCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (InstanceOccurrenceRecord occurrence in occurrences)
            {
                Increment(geometryQualityCounts, occurrence.GeometryQuality);
                Increment(roleCounts, occurrence.SemanticRole);
                if (occurrence.IsBlockReference) { BlockReferenceOccurrenceCount++; }
                if (occurrence.HasWorldPath) { CurveOccurrenceCount++; }
                if (occurrence.WorldTransform.IsMirrored) { MirroredOccurrenceCount++; }
                if (occurrence.IsDynamicBlock) { DynamicBlockOccurrenceCount++; }
                if (occurrence.IsExternalReference) { ExternalReferenceOccurrenceCount++; }
            }
        }

        public string DrawingId { get; private set; }
        public int DefinitionCount { get; private set; }
        public int RootSpaceCount { get; private set; }
        public int BlockReferenceOccurrenceCount { get; private set; }
        public int CurveOccurrenceCount { get; private set; }
        public int MirroredOccurrenceCount { get; private set; }
        public int DynamicBlockOccurrenceCount { get; private set; }
        public int ExternalReferenceOccurrenceCount { get; private set; }
        public IList<InstanceOccurrenceRecord> Occurrences { get { return occurrences.AsReadOnly(); } }
        public IList<BlockInstanceDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            var occurrenceMaps = new List<Dictionary<string, object>>();
            foreach (InstanceOccurrenceRecord occurrence in occurrences)
            {
                occurrenceMaps.Add(occurrence.ToMap());
            }
            var diagnosticMaps = new List<Dictionary<string, object>>();
            foreach (BlockInstanceDiagnosticRecord diagnostic in diagnostics)
            {
                diagnosticMaps.Add(diagnostic.ToMap());
            }
            return InstanceMaps.Map(
                "schema_version", "1",
                "analysis_type", "block_instance_coordinate_facts",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "definition_count", DefinitionCount,
                "root_space_count", RootSpaceCount,
                "occurrence_count", occurrences.Count,
                "block_reference_occurrence_count", BlockReferenceOccurrenceCount,
                "curve_occurrence_count", CurveOccurrenceCount,
                "mirrored_occurrence_count", MirroredOccurrenceCount,
                "dynamic_block_occurrence_count", DynamicBlockOccurrenceCount,
                "external_reference_occurrence_count", ExternalReferenceOccurrenceCount,
                "diagnostic_count", diagnostics.Count,
                "geometry_quality_counts", new Dictionary<string, int>(geometryQualityCounts),
                "role_counts", new Dictionary<string, int>(roleCounts),
                "occurrences", occurrenceMaps,
                "diagnostics", diagnosticMaps,
                "coordinate_contract", InstanceMaps.Map(
                    "model", "definition_occurrence_separation",
                    "world_transform_composition", "parent_times_local_column_vector",
                    "block_transform_capture", "origin_and_basis_points_not_matrix_array_guessing",
                    "style_resolution", "layer0_and_ByBlock_resolved_along_instance_path",
                    "source_identity", "definition_handle+entity_handle+instance_path"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 块实例与统一坐标事实");
            sb.AppendLine();
            sb.AppendLine("- 图纸：`" + DrawingId + "`");
            sb.AppendLine("- 定义 / 根空间：" + DefinitionCount.ToString(CultureInfo.InvariantCulture)
                + " / " + RootSpaceCount.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 展开实例：" + occurrences.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 世界坐标曲线实例：" + CurveOccurrenceCount.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 镜像实例：" + MirroredOccurrenceCount.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 诊断：" + diagnostics.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine();
            sb.AppendLine("定义实体只保存一次；每个显示实例通过稳定 instance_path 关联源句柄、世界变换和有效样式。");
            sb.AppendLine("0 层、ByBlock、镜像、嵌套块与 MINSERT 均沿实例路径计算，原 DWG 未被炸开或修改。");
            return sb.ToString().TrimEnd();
        }

        static void Increment(IDictionary<string, int> values, string key)
        {
            key = key ?? "";
            int count;
            values.TryGetValue(key, out count);
            values[key] = count + 1;
        }
    }

    public static class BlockInstanceCoordinateAnalyzer
    {
        sealed class TraversalState
        {
            public string RootHandle;
            public string RootName;
            public readonly List<string> DefinitionStack = new List<string>();
            public readonly List<string> Path = new List<string>();
        }

        public static BlockInstanceCoordinateDocument Analyze(
            InstanceDrawingObservation drawing,
            IDictionary<string, string> semanticRolesBySourceHandle = null,
            BlockInstanceAnalysisConfig config = null)
        {
            if (drawing == null)
            {
                throw new ArgumentNullException("drawing");
            }
            config = config ?? new BlockInstanceAnalysisConfig();
            var definitions = new Dictionary<string, InstanceDefinitionObservation>(
                StringComparer.OrdinalIgnoreCase);
            foreach (InstanceDefinitionObservation definition in drawing.Definitions)
            {
                if (definition != null && !definitions.ContainsKey(definition.Handle))
                {
                    definitions[definition.Handle] = definition;
                }
            }
            var layers = new Dictionary<string, InstanceLayerObservation>(
                StringComparer.OrdinalIgnoreCase);
            foreach (InstanceLayerObservation layer in drawing.Layers)
            {
                if (layer != null && !layers.ContainsKey(layer.Name))
                {
                    layers[layer.Name] = layer;
                }
            }
            var occurrences = new List<InstanceOccurrenceRecord>();
            var diagnostics = new List<BlockInstanceDiagnosticRecord>();
            int rootCount = 0;
            foreach (InstanceDefinitionObservation root in drawing.Definitions)
            {
                if (root == null || !root.IsRootSpace)
                {
                    continue;
                }
                rootCount++;
                var state = new TraversalState
                {
                    RootHandle = root.Handle,
                    RootName = root.Name
                };
                state.DefinitionStack.Add(root.Handle);
                state.Path.Add("root:" + Stable(root.Handle));
                WalkDefinition(
                    root,
                    InstanceAffineTransformObservation.Identity,
                    null,
                    0,
                    state,
                    definitions,
                    layers,
                    semanticRolesBySourceHandle,
                    config,
                    occurrences,
                    diagnostics);
            }
            if (rootCount == 0)
            {
                diagnostics.Add(new BlockInstanceDiagnosticRecord(
                    "NO_ROOT_SPACE",
                    "unsupported",
                    "",
                    "",
                    "No model-space or paper-space definition was supplied."));
            }
            return new BlockInstanceCoordinateDocument(
                drawing.DrawingId,
                drawing.Definitions.Count,
                rootCount,
                occurrences,
                diagnostics);
        }

        static void WalkDefinition(
            InstanceDefinitionObservation definition,
            InstanceAffineTransformObservation parentTransform,
            InstanceEffectiveStyleRecord insertionStyle,
            int depth,
            TraversalState state,
            IDictionary<string, InstanceDefinitionObservation> definitions,
            IDictionary<string, InstanceLayerObservation> layers,
            IDictionary<string, string> roles,
            BlockInstanceAnalysisConfig config,
            IList<InstanceOccurrenceRecord> occurrences,
            IList<BlockInstanceDiagnosticRecord> diagnostics)
        {
            foreach (InstanceEntityObservation entity in definition.Entities)
            {
                if (occurrences.Count >= config.MaxOccurrenceCount)
                {
                    if (!ContainsDiagnostic(diagnostics, "OCCURRENCE_LIMIT_REACHED"))
                    {
                        diagnostics.Add(new BlockInstanceDiagnosticRecord(
                            "OCCURRENCE_LIMIT_REACHED",
                            "unsupported",
                            string.Join("/", state.Path.ToArray()),
                            entity == null ? "" : entity.Handle,
                            "Traversal stopped at configured occurrence limit."));
                    }
                    return;
                }
                if (entity == null)
                {
                    continue;
                }
                InstanceEffectiveStyleRecord effectiveStyle = ResolveStyle(
                    entity,
                    insertionStyle,
                    layers);
                string role = RoleOf(roles, entity.Handle);
                if (!entity.IsBlockReference)
                {
                    var entityPath = new List<string>(state.Path);
                    entityPath.Add("ent:" + Stable(entity.Handle));
                    string occurrenceId = string.Join("/", entityPath.ToArray());
                    if (config.EmitNonCurveOccurrences || entity.IsCurve)
                    {
                        occurrences.Add(new InstanceOccurrenceRecord(
                            occurrenceId,
                            state.RootHandle,
                            state.RootName,
                            definition.Handle,
                            definition.Name,
                            entity,
                            entityPath,
                            depth,
                            0,
                            0,
                            parentTransform,
                            effectiveStyle,
                            role,
                            entity.IsCurve ? "computed" : "unsupported_geometry_retained"));
                    }
                    continue;
                }

                for (int row = 0; row < entity.RowCount; row++)
                {
                    for (int column = 0; column < entity.ColumnCount; column++)
                    {
                        InstanceAffineTransformObservation cellOffset =
                            InstanceAffineTransformObservation.Translation(
                                column * entity.ColumnSpacing,
                                row * entity.RowSpacing,
                                0);
                        InstanceAffineTransformObservation local = entity.LocalTransform.Multiply(cellOffset);
                        InstanceAffineTransformObservation world = parentTransform.Multiply(local);
                        var referencePath = new List<string>(state.Path);
                        referencePath.Add("ref:" + Stable(entity.Handle)
                            + "[" + row.ToString(CultureInfo.InvariantCulture)
                            + "," + column.ToString(CultureInfo.InvariantCulture) + "]");
                        string referenceId = string.Join("/", referencePath.ToArray());
                        string status = entity.IsExternalReference
                            ? "computed_loaded_external_reference"
                            : entity.IsDynamic
                                ? "computed_dynamic_effective_definition"
                                : "computed";
                        occurrences.Add(new InstanceOccurrenceRecord(
                            referenceId,
                            state.RootHandle,
                            state.RootName,
                            definition.Handle,
                            definition.Name,
                            entity,
                            referencePath,
                            depth,
                            row,
                            column,
                            world,
                            effectiveStyle,
                            role,
                            status));

                        InstanceDefinitionObservation target;
                        if (!definitions.TryGetValue(entity.TargetDefinitionHandle, out target))
                        {
                            diagnostics.Add(new BlockInstanceDiagnosticRecord(
                                "TARGET_DEFINITION_MISSING",
                                "unsupported",
                                referenceId,
                                entity.Handle,
                                "Block definition " + entity.TargetDefinitionHandle + " is not available."));
                            continue;
                        }
                        if (depth + 1 > config.MaxNestingDepth)
                        {
                            diagnostics.Add(new BlockInstanceDiagnosticRecord(
                                "MAX_NESTING_DEPTH_REACHED",
                                "unsupported",
                                referenceId,
                                entity.Handle,
                                "Nested block traversal stopped at configured depth."));
                            continue;
                        }
                        if (ContainsIgnoreCase(state.DefinitionStack, target.Handle))
                        {
                            diagnostics.Add(new BlockInstanceDiagnosticRecord(
                                "CYCLIC_BLOCK_REFERENCE",
                                "ambiguous",
                                referenceId,
                                entity.Handle,
                                "Recursive definition cycle was retained as a diagnostic and not expanded."));
                            continue;
                        }
                        state.DefinitionStack.Add(target.Handle);
                        state.Path.Add(referencePath[referencePath.Count - 1]);
                        WalkDefinition(
                            target,
                            world,
                            effectiveStyle,
                            depth + 1,
                            state,
                            definitions,
                            layers,
                            roles,
                            config,
                            occurrences,
                            diagnostics);
                        state.Path.RemoveAt(state.Path.Count - 1);
                        state.DefinitionStack.RemoveAt(state.DefinitionStack.Count - 1);
                    }
                }
            }
        }

        static InstanceEffectiveStyleRecord ResolveStyle(
            InstanceEntityObservation entity,
            InstanceEffectiveStyleRecord insertionStyle,
            IDictionary<string, InstanceLayerObservation> layers)
        {
            string layerName = entity.Layer ?? "";
            string layerSource = "entity_layer";
            if (insertionStyle != null
                && string.Equals(layerName, "0", StringComparison.OrdinalIgnoreCase))
            {
                layerName = insertionStyle.Layer;
                layerSource = "layer0_inherits_insert_layer";
            }
            InstanceLayerObservation layer;
            layers.TryGetValue(layerName ?? "", out layer);
            InstanceColorObservation color;
            string colorSource;
            if (string.Equals(entity.RawColor.Mode, "explicit", StringComparison.OrdinalIgnoreCase))
            {
                color = entity.RawColor;
                colorSource = "entity_explicit";
            }
            else if (string.Equals(entity.RawColor.Mode, "by_block", StringComparison.OrdinalIgnoreCase)
                && insertionStyle != null)
            {
                color = insertionStyle.Color;
                colorSource = "ByBlock_from_insert";
            }
            else
            {
                color = layer == null
                    ? entity.RawColor
                    : layer.Color;
                colorSource = (layer == null ? "unresolved_layer_fallback" : "ByLayer")
                    + ":" + layerSource;
            }

            string linetype;
            string linetypeSource;
            if (string.Equals(entity.RawLinetypeMode, "explicit", StringComparison.OrdinalIgnoreCase))
            {
                linetype = entity.RawLinetype;
                linetypeSource = "entity_explicit";
            }
            else if (string.Equals(entity.RawLinetypeMode, "by_block", StringComparison.OrdinalIgnoreCase)
                && insertionStyle != null)
            {
                linetype = insertionStyle.Linetype;
                linetypeSource = "ByBlock_from_insert";
            }
            else
            {
                linetype = layer == null ? entity.RawLinetype : layer.Linetype;
                linetypeSource = (layer == null ? "unresolved_layer_fallback" : "ByLayer")
                    + ":" + layerSource;
            }

            int? lineweight;
            string lineweightSource;
            if (string.Equals(entity.RawLineweightMode, "explicit", StringComparison.OrdinalIgnoreCase)
                && entity.HasRawLineweight)
            {
                lineweight = entity.RawLineweight;
                lineweightSource = "entity_explicit";
            }
            else if (string.Equals(entity.RawLineweightMode, "by_block", StringComparison.OrdinalIgnoreCase)
                && insertionStyle != null)
            {
                lineweight = insertionStyle.HasLineweight
                    ? (int?)insertionStyle.Lineweight
                    : null;
                lineweightSource = "ByBlock_from_insert";
            }
            else
            {
                lineweight = layer != null && layer.HasLineweight
                    ? (int?)layer.Lineweight
                    : null;
                lineweightSource = (layer == null ? "unresolved_layer" : "ByLayer")
                    + ":" + layerSource;
            }
            bool suppressed = layer != null && (layer.IsOff || layer.IsFrozen);
            return new InstanceEffectiveStyleRecord(
                layerName,
                color,
                colorSource,
                linetype,
                linetypeSource,
                lineweight,
                lineweightSource,
                suppressed);
        }

        static string RoleOf(IDictionary<string, string> values, string handle)
        {
            if (values == null)
            {
                return "unclassified";
            }
            string role;
            return values.TryGetValue(handle ?? "", out role) && !string.IsNullOrEmpty(role)
                ? role
                : "unclassified";
        }

        static bool ContainsIgnoreCase(IList<string> values, string target)
        {
            foreach (string value in values)
            {
                if (string.Equals(value, target, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        static bool ContainsDiagnostic(IList<BlockInstanceDiagnosticRecord> values, string code)
        {
            foreach (BlockInstanceDiagnosticRecord value in values)
            {
                if (value.Code == code)
                {
                    return true;
                }
            }
            return false;
        }

        static string Stable(string value)
        {
            return (value ?? "")
                .Replace("/", "%2F")
                .Replace("[", "%5B")
                .Replace("]", "%5D");
        }
    }

    internal static class InstanceMaps
    {
        public static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[Convert.ToString(values[index], CultureInfo.InvariantCulture) ?? ""] =
                    values[index + 1];
            }
            return result;
        }
    }
}
