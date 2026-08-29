using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class CrossDrawingInterfaceGraphConfig
    {
        public CrossDrawingInterfaceGraphConfig()
        {
            AbsoluteMetricTolerance = 0.1;
            RelativeMetricTolerance = 0.02;
            CandidateTieTolerance = 0.01;
            SupportedInterfaceScore = 0.90;
            ReferencePointerDistanceRatio = 0.025;
            MinimumReferencePointerDistance = 1.0;
            MaximumDrawingCount = 10000;
            MaximumReferenceCount = 200000;
            MaximumInterfaceCount = 500000;
            MaximumCandidateComparisonCount = 5000000;
            MaximumTextReferencesPerDrawing = 2000;
            MaximumPointerInterfaceCandidates = 8;
        }

        public double AbsoluteMetricTolerance { get; set; }
        public double RelativeMetricTolerance { get; set; }
        public double CandidateTieTolerance { get; set; }
        public double SupportedInterfaceScore { get; set; }
        public double ReferencePointerDistanceRatio { get; set; }
        public double MinimumReferencePointerDistance { get; set; }
        public int MaximumDrawingCount { get; set; }
        public int MaximumReferenceCount { get; set; }
        public int MaximumInterfaceCount { get; set; }
        public long MaximumCandidateComparisonCount { get; set; }
        public int MaximumTextReferencesPerDrawing { get; set; }
        public int MaximumPointerInterfaceCandidates { get; set; }
    }

    public static class CrossDrawingSemanticStatus
    {
        public const string Supported = "supported";
        public const string Possible = "possible";
        public const string Conflicted = "conflicted";
        public const string Unresolved = "unresolved";
    }

    public sealed class CrossDrawingDrawingObservation
    {
        readonly List<CrossDrawingComponentReferenceObservation> componentReferences;
        readonly List<CrossDrawingInterfaceObservation> interfaces;
        readonly Dictionary<string, string> evidence;

        public CrossDrawingDrawingObservation(
            string snapshotId,
            string drawingId,
            string drawingNumber)
        {
            SnapshotId = snapshotId ?? "";
            DrawingId = drawingId ?? "";
            DrawingNumber = drawingNumber ?? "";
            SourceStatus = "computed";
            componentReferences = new List<CrossDrawingComponentReferenceObservation>();
            interfaces = new List<CrossDrawingInterfaceObservation>();
            evidence = new Dictionary<string, string>(StringComparer.Ordinal);
        }

        public string SnapshotId { get; private set; }
        public string DrawingId { get; private set; }
        public string DrawingNumber { get; private set; }
        public string DrawingName { get; private set; }
        public string Revision { get; private set; }
        public string Stage { get; private set; }
        public string Sheet { get; private set; }
        public string SheetCount { get; private set; }
        public string ProductModel { get; private set; }
        public string SourcePath { get; private set; }
        public string SourceStatus { get; private set; }
        public bool Truncated { get; private set; }
        public string UnitName { get; private set; }
        public string MeasurementSystem { get; private set; }
        public bool ComparableGeometryScaleProven { get; private set; }
        public string GeometryScaleEvidence { get; private set; }
        public string NormalizedDrawingNumber
        {
            get { return CrossDrawingMaps.NormalizeIdentity(DrawingNumber); }
        }
        public string NormalizedSheet
        {
            get { return CrossDrawingMaps.NormalizeIdentity(Sheet); }
        }
        public string DrawingKey
        {
            get
            {
                string number = NormalizedDrawingNumber;
                return string.IsNullOrEmpty(number)
                    ? "drawing-id:" + CrossDrawingMaps.NormalizeIdentity(DrawingId)
                    : number + "|sheet:" + NormalizedSheet;
            }
        }
        public string NodeId
        {
            get { return "drawing:" + CrossDrawingMaps.Hash(SnapshotId, DrawingKey); }
        }
        public IList<CrossDrawingComponentReferenceObservation> ComponentReferences
        {
            get { return componentReferences.AsReadOnly(); }
        }
        public IList<CrossDrawingInterfaceObservation> Interfaces
        {
            get { return interfaces.AsReadOnly(); }
        }
        public IDictionary<string, string> Evidence
        {
            get { return new ReadOnlyDictionary<string, string>(evidence); }
        }

        public CrossDrawingDrawingObservation SetTitle(
            string drawingName,
            string revision,
            string stage,
            string sheet,
            string sheetCount,
            string productModel)
        {
            DrawingName = drawingName ?? "";
            Revision = revision ?? "";
            Stage = stage ?? "";
            Sheet = sheet ?? "";
            SheetCount = sheetCount ?? "";
            ProductModel = productModel ?? "";
            return this;
        }

        public CrossDrawingDrawingObservation SetSource(
            string sourcePath,
            string sourceStatus,
            bool truncated)
        {
            SourcePath = sourcePath ?? "";
            SourceStatus = string.IsNullOrWhiteSpace(sourceStatus) ? "computed" : sourceStatus;
            Truncated = truncated;
            return this;
        }

        public CrossDrawingDrawingObservation SetUnitContext(
            string unitName,
            string measurementSystem,
            bool comparableGeometryScaleProven,
            string evidenceValue)
        {
            UnitName = unitName ?? "";
            MeasurementSystem = measurementSystem ?? "";
            ComparableGeometryScaleProven = comparableGeometryScaleProven;
            GeometryScaleEvidence = evidenceValue ?? "";
            return this;
        }

        public CrossDrawingDrawingObservation AddEvidence(string key, string value)
        {
            if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(value))
            {
                evidence[key] = value;
            }
            return this;
        }

        public CrossDrawingDrawingObservation AddComponentReference(
            CrossDrawingComponentReferenceObservation value)
        {
            if (value != null && !componentReferences.Any(item => item.Id == value.Id))
            {
                componentReferences.Add(value);
            }
            return this;
        }

        public CrossDrawingDrawingObservation AddInterface(
            CrossDrawingInterfaceObservation value)
        {
            if (value != null && !interfaces.Any(item => item.Id == value.Id))
            {
                interfaces.Add(value);
            }
            return this;
        }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "snapshot_id", SnapshotId,
                "drawing_node_id", NodeId,
                "drawing_id", DrawingId,
                "drawing_number", DrawingNumber,
                "normalized_drawing_number", NormalizedDrawingNumber,
                "drawing_name", DrawingName,
                "revision", Revision,
                "stage", Stage,
                "sheet", Sheet,
                "sheet_count", SheetCount,
                "product_model", ProductModel,
                "drawing_key", DrawingKey,
                "source_path", SourcePath,
                "source_status", SourceStatus,
                "truncated", Truncated,
                "unit_name", UnitName,
                "measurement_system", MeasurementSystem,
                "comparable_geometry_scale_proven", ComparableGeometryScaleProven,
                "geometry_scale_evidence", GeometryScaleEvidence,
                "evidence", new Dictionary<string, string>(evidence),
                "component_reference_count", componentReferences.Count,
                "interface_reference_count", interfaces.Count,
                "component_references", componentReferences.OrderBy(value => value.Id, StringComparer.Ordinal)
                    .Select(value => value.ToMap()).ToList(),
                "interface_references", interfaces.OrderBy(value => value.Id, StringComparer.Ordinal)
                    .Select(value => value.ToMap()).ToList());
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 跨图项目输入观察");
            builder.AppendLine();
            builder.AppendLine("- 快照：`" + SnapshotId + "`");
            builder.AppendLine("- 图样代号 / 页码：`" + DrawingNumber + "` / `" + Sheet + "`");
            builder.AppendLine("- 版本 / 阶段：`" + Revision + "` / `" + Stage + "`");
            builder.AppendLine("- 构件引用 / 接口引用："
                + componentReferences.Count.ToString(CultureInfo.InvariantCulture) + " / "
                + interfaces.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("该文件只是单图对项目图的只读贡献；必须与其他图纸 observation 一起交给 20，才会产生跨文件身份和接口比较。");
            return builder.ToString().TrimEnd();
        }
    }

    public sealed class CrossDrawingComponentReferenceObservation
    {
        readonly List<string> sourceIds;
        readonly List<string> sourceHandles;
        readonly List<string> associatedInterfaceIds;

        public CrossDrawingComponentReferenceObservation(
            string id,
            string referenceCode,
            string evidenceKind,
            string sourceElementId)
        {
            Id = id ?? "";
            ReferenceCode = referenceCode ?? "";
            EvidenceKind = evidenceKind ?? "unknown";
            SourceElementId = sourceElementId ?? "";
            AssociationStatus = CrossDrawingSemanticStatus.Unresolved;
            sourceIds = new List<string>();
            sourceHandles = new List<string>();
            associatedInterfaceIds = new List<string>();
        }

        public string Id { get; private set; }
        public string ReferenceCode { get; private set; }
        public string NormalizedReferenceCode
        {
            get { return CrossDrawingMaps.NormalizeIdentity(ReferenceCode); }
        }
        public string EvidenceKind { get; private set; }
        public string SourceElementId { get; private set; }
        public string ItemNumber { get; private set; }
        public string Name { get; private set; }
        public string Quantity { get; private set; }
        public string ReferencedSheet { get; private set; }
        public string ReferencedRevision { get; private set; }
        public string SourceText { get; private set; }
        public bool HasPointer { get; private set; }
        public double PointerX { get; private set; }
        public double PointerY { get; private set; }
        public string AssociationStatus { get; private set; }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public IList<string> AssociatedInterfaceIds { get { return associatedInterfaceIds.AsReadOnly(); } }
        public bool IsStructuredAuthoredReference
        {
            get
            {
                return EvidenceKind == "authored_bom_part_number"
                    || EvidenceKind == "authored_external_reference"
                    || EvidenceKind == "authored_hyperlink"
                    || EvidenceKind == "manual_explicit_reference";
            }
        }
        public bool LooksLikeDrawingCode
        {
            get { return CrossDrawingMaps.LooksLikeDrawingCode(ReferenceCode); }
        }

        public CrossDrawingComponentReferenceObservation SetBomContext(
            string itemNumber,
            string name,
            string quantity)
        {
            ItemNumber = itemNumber ?? "";
            Name = name ?? "";
            Quantity = quantity ?? "";
            return this;
        }

        public CrossDrawingComponentReferenceObservation SetReferenceQualifier(
            string sheet,
            string revision)
        {
            ReferencedSheet = sheet ?? "";
            ReferencedRevision = revision ?? "";
            return this;
        }

        public CrossDrawingComponentReferenceObservation SetSourceText(string value)
        {
            SourceText = value ?? "";
            return this;
        }

        public CrossDrawingComponentReferenceObservation SetPointer(double x, double y)
        {
            if (CrossDrawingMaps.IsFinite(x) && CrossDrawingMaps.IsFinite(y))
            {
                HasPointer = true;
                PointerX = x;
                PointerY = y;
            }
            return this;
        }

        public CrossDrawingComponentReferenceObservation AddAssociatedInterface(
            string interfaceId,
            string status)
        {
            if (!string.IsNullOrWhiteSpace(interfaceId)
                && !associatedInterfaceIds.Contains(interfaceId))
            {
                associatedInterfaceIds.Add(interfaceId);
                associatedInterfaceIds.Sort(StringComparer.Ordinal);
            }
            AssociationStatus = CrossDrawingMaps.StrongerStatus(AssociationStatus, status);
            return this;
        }

        public CrossDrawingComponentReferenceObservation AddSourceId(string value)
        {
            CrossDrawingMaps.AddUnique(sourceIds, value, StringComparer.Ordinal);
            return this;
        }

        public CrossDrawingComponentReferenceObservation AddSourceHandle(string value)
        {
            CrossDrawingMaps.AddUnique(sourceHandles, value, StringComparer.OrdinalIgnoreCase);
            return this;
        }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "component_reference_id", Id,
                "reference_code", ReferenceCode,
                "normalized_reference_code", NormalizedReferenceCode,
                "looks_like_drawing_code", LooksLikeDrawingCode,
                "evidence_kind", EvidenceKind,
                "source_element_id", SourceElementId,
                "item_number", ItemNumber,
                "name", Name,
                "quantity", Quantity,
                "referenced_sheet", ReferencedSheet,
                "referenced_revision", ReferencedRevision,
                "source_text", SourceText,
                "pointer", HasPointer ? (object)new[] { PointerX, PointerY } : null,
                "association_status", AssociationStatus,
                "associated_interface_ids", new List<string>(associatedInterfaceIds),
                "source_ids", new List<string>(sourceIds),
                "source_handles", new List<string>(sourceHandles));
        }
    }

    public sealed class CrossDrawingInterfaceObservation
    {
        readonly Dictionary<string, double> metrics;
        readonly Dictionary<string, string> semanticValues;
        readonly Dictionary<string, List<double>> boundDimensionValues;
        readonly List<string> sourceIds;
        readonly List<string> sourceHandles;

        public CrossDrawingInterfaceObservation(
            string id,
            string sourceElementId,
            string domain,
            string kind,
            string shapeClass,
            string evidenceStatus)
        {
            Id = id ?? "";
            SourceElementId = sourceElementId ?? "";
            Domain = domain ?? "unknown";
            Kind = kind ?? "unknown";
            ShapeClass = shapeClass ?? "";
            EvidenceStatus = evidenceStatus ?? "unknown";
            metrics = new Dictionary<string, double>(StringComparer.Ordinal);
            semanticValues = new Dictionary<string, string>(StringComparer.Ordinal);
            boundDimensionValues = new Dictionary<string, List<double>>(StringComparer.Ordinal);
            sourceIds = new List<string>();
            sourceHandles = new List<string>();
        }

        public string Id { get; private set; }
        public string SourceElementId { get; private set; }
        public string Domain { get; private set; }
        public string Kind { get; private set; }
        public string ShapeClass { get; private set; }
        public string EvidenceStatus { get; private set; }
        public string GeometrySignature { get; private set; }
        public string MatchSignature { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public bool HasAnchor { get; private set; }
        public double AnchorX { get; private set; }
        public double AnchorY { get; private set; }
        public bool HasLocalFrame { get; private set; }
        public double LocalX { get; private set; }
        public double LocalY { get; private set; }
        public double LocalDirectionDegrees { get; private set; }
        public double LocalFrameScale { get; private set; }
        public string LocalFrameScaleSource { get; private set; }
        public IDictionary<string, double> Metrics
        {
            get { return new ReadOnlyDictionary<string, double>(metrics); }
        }
        public IDictionary<string, string> SemanticValues
        {
            get { return new ReadOnlyDictionary<string, string>(semanticValues); }
        }
        public IDictionary<string, IList<double>> BoundDimensionValues
        {
            get
            {
                return new ReadOnlyDictionary<string, IList<double>>(
                    boundDimensionValues.ToDictionary(
                        pair => pair.Key,
                        pair => (IList<double>)pair.Value.AsReadOnly(),
                        StringComparer.Ordinal));
            }
        }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public string FamilyKey
        {
            get
            {
                return string.Join("|", new[]
                {
                    Domain,
                    Kind,
                    ShapeClass
                });
            }
        }

        public CrossDrawingInterfaceObservation SetSignatures(
            string matchSignature,
            string geometrySignature)
        {
            MatchSignature = matchSignature ?? "";
            GeometrySignature = geometrySignature ?? "";
            return this;
        }

        public CrossDrawingInterfaceObservation SetContext(
            string regionId,
            string physicalObjectClusterId)
        {
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = physicalObjectClusterId ?? "";
            return this;
        }

        public CrossDrawingInterfaceObservation SetBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (CrossDrawingMaps.IsFinite(minX) && CrossDrawingMaps.IsFinite(minY)
                && CrossDrawingMaps.IsFinite(maxX) && CrossDrawingMaps.IsFinite(maxY))
            {
                HasBounds = true;
                MinX = Math.Min(minX, maxX);
                MinY = Math.Min(minY, maxY);
                MaxX = Math.Max(minX, maxX);
                MaxY = Math.Max(minY, maxY);
                SetAnchor((MinX + MaxX) * 0.5, (MinY + MaxY) * 0.5);
            }
            return this;
        }

        public CrossDrawingInterfaceObservation SetAnchor(double x, double y)
        {
            if (CrossDrawingMaps.IsFinite(x) && CrossDrawingMaps.IsFinite(y))
            {
                HasAnchor = true;
                AnchorX = x;
                AnchorY = y;
            }
            return this;
        }

        public CrossDrawingInterfaceObservation SetLocalFrame(
            double localX,
            double localY,
            double localDirectionDegrees,
            double scale,
            string scaleSource)
        {
            if (CrossDrawingMaps.IsFinite(localX) && CrossDrawingMaps.IsFinite(localY)
                && CrossDrawingMaps.IsFinite(localDirectionDegrees)
                && CrossDrawingMaps.IsFinite(scale) && scale > 0)
            {
                HasLocalFrame = true;
                LocalX = localX;
                LocalY = localY;
                LocalDirectionDegrees = localDirectionDegrees;
                LocalFrameScale = scale;
                LocalFrameScaleSource = scaleSource ?? "";
            }
            return this;
        }

        public CrossDrawingInterfaceObservation AddMetric(string key, double value)
        {
            if (!string.IsNullOrWhiteSpace(key) && CrossDrawingMaps.IsFinite(value))
            {
                metrics[key] = value;
            }
            return this;
        }

        public CrossDrawingInterfaceObservation AddSemanticValue(string key, string value)
        {
            if (!string.IsNullOrWhiteSpace(key)) { semanticValues[key] = value ?? ""; }
            return this;
        }

        public CrossDrawingInterfaceObservation AddBoundDimensionValue(string key, double value)
        {
            if (string.IsNullOrWhiteSpace(key) || !CrossDrawingMaps.IsFinite(value))
            {
                return this;
            }
            List<double> values;
            if (!boundDimensionValues.TryGetValue(key, out values))
            {
                values = new List<double>();
                boundDimensionValues[key] = values;
            }
            if (!values.Any(item => Math.Abs(item - value) <= 0.000000001))
            {
                values.Add(value);
                values.Sort();
            }
            return this;
        }

        public CrossDrawingInterfaceObservation AddSourceId(string value)
        {
            CrossDrawingMaps.AddUnique(sourceIds, value, StringComparer.Ordinal);
            return this;
        }

        public CrossDrawingInterfaceObservation AddSourceHandle(string value)
        {
            CrossDrawingMaps.AddUnique(sourceHandles, value, StringComparer.OrdinalIgnoreCase);
            return this;
        }

        public bool TryMetric(string key, out double value)
        {
            return metrics.TryGetValue(key, out value);
        }

        public Dictionary<string, object> ToMap()
        {
            var dimensionMap = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, List<double>> pair in boundDimensionValues)
            {
                dimensionMap[pair.Key] = new List<double>(pair.Value);
            }
            return CrossDrawingMaps.Map(
                "interface_reference_id", Id,
                "source_element_id", SourceElementId,
                "domain", Domain,
                "kind", Kind,
                "shape_class", ShapeClass,
                "family_key", FamilyKey,
                "evidence_status", EvidenceStatus,
                "match_signature", MatchSignature,
                "geometry_signature", GeometrySignature,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "bounds", HasBounds ? (object)new[] { MinX, MinY, MaxX, MaxY } : null,
                "anchor", HasAnchor ? (object)new[] { AnchorX, AnchorY } : null,
                "local_frame", HasLocalFrame ? (object)CrossDrawingMaps.Map(
                    "position", new[] { LocalX, LocalY },
                    "direction_degrees", LocalDirectionDegrees,
                    "scale", LocalFrameScale,
                    "scale_source", LocalFrameScaleSource) : null,
                "metrics", new Dictionary<string, double>(metrics),
                "semantic_values", new Dictionary<string, string>(semanticValues),
                "bound_dimension_values", dimensionMap,
                "source_ids", new List<string>(sourceIds),
                "source_handles", new List<string>(sourceHandles));
        }
    }

    public sealed class CrossDrawingRelationRecord
    {
        readonly List<string> evidence;
        readonly List<string> sourceIds;

        internal CrossDrawingRelationRecord(
            string relationType,
            string sourceId,
            string targetId,
            string status,
            string evidenceGrade,
            string resolution,
            IEnumerable<string> evidenceValues,
            IEnumerable<string> sourceValues)
        {
            RelationType = relationType ?? "unknown";
            SourceId = sourceId ?? "";
            TargetId = targetId ?? "";
            Status = status ?? CrossDrawingSemanticStatus.Unresolved;
            EvidenceGrade = evidenceGrade ?? "unknown";
            Resolution = resolution ?? "";
            evidence = CrossDrawingMaps.SortedUnique(evidenceValues, StringComparer.Ordinal);
            sourceIds = CrossDrawingMaps.SortedUnique(sourceValues, StringComparer.Ordinal);
            Id = "cross-drawing-relation:" + CrossDrawingMaps.Hash(
                RelationType, SourceId, TargetId, Status, Resolution,
                string.Join("|", evidence));
        }

        public string Id { get; private set; }
        public string RelationType { get; private set; }
        public string SourceId { get; private set; }
        public string TargetId { get; private set; }
        public string Status { get; private set; }
        public string EvidenceGrade { get; private set; }
        public string Resolution { get; private set; }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "relation_id", Id,
                "relation_type", RelationType,
                "source_id", SourceId,
                "target_id", TargetId,
                "status", Status,
                "evidence_grade", EvidenceGrade,
                "resolution", Resolution,
                "evidence", new List<string>(evidence),
                "source_ids", new List<string>(sourceIds));
        }
    }

    public sealed class CrossDrawingIdentityAssertionRecord
    {
        readonly List<string> memberIds;
        readonly List<string> sourceSnapshotIds;
        readonly List<string> support;
        readonly List<string> conflicts;
        readonly List<string> unresolvedMemberIds;

        internal CrossDrawingIdentityAssertionRecord(
            string identityType,
            IEnumerable<string> members,
            IEnumerable<string> snapshots,
            string status,
            string evidenceGrade,
            IEnumerable<string> supportValues,
            IEnumerable<string> conflictValues,
            IEnumerable<string> unresolvedValues)
        {
            IdentityType = identityType ?? "unknown";
            memberIds = CrossDrawingMaps.SortedUnique(members, StringComparer.Ordinal);
            sourceSnapshotIds = CrossDrawingMaps.SortedUnique(snapshots, StringComparer.Ordinal);
            Status = status ?? CrossDrawingSemanticStatus.Unresolved;
            EvidenceGrade = evidenceGrade ?? "unknown";
            support = CrossDrawingMaps.SortedUnique(supportValues, StringComparer.Ordinal);
            conflicts = CrossDrawingMaps.SortedUnique(conflictValues, StringComparer.Ordinal);
            unresolvedMemberIds = CrossDrawingMaps.SortedUnique(unresolvedValues, StringComparer.Ordinal);
            Id = "cross-drawing-identity:" + CrossDrawingMaps.Hash(
                IdentityType,
                string.Join("|", memberIds),
                string.Join("|", sourceSnapshotIds));
        }

        public string Id { get; private set; }
        public string IdentityType { get; private set; }
        public string Status { get; private set; }
        public string EvidenceGrade { get; private set; }
        public IList<string> MemberIds { get { return memberIds.AsReadOnly(); } }
        public IList<string> SourceSnapshotIds { get { return sourceSnapshotIds.AsReadOnly(); } }
        public IList<string> Support { get { return support.AsReadOnly(); } }
        public IList<string> Conflicts { get { return conflicts.AsReadOnly(); } }
        public IList<string> UnresolvedMemberIds { get { return unresolvedMemberIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "identity_assertion_id", Id,
                "identity_type", IdentityType,
                "member_ids", new List<string>(memberIds),
                "source_snapshot_ids", new List<string>(sourceSnapshotIds),
                "status", Status,
                "evidence_grade", EvidenceGrade,
                "support", new List<string>(support),
                "conflicts", new List<string>(conflicts),
                "unresolved_member_ids", new List<string>(unresolvedMemberIds));
        }
    }

    public sealed class CrossDrawingMetricComparisonRecord
    {
        internal CrossDrawingMetricComparisonRecord(
            string metric,
            double sourceValue,
            double targetValue,
            double absoluteDifference,
            double allowedDifference,
            string basis,
            string status)
        {
            Metric = metric ?? "";
            SourceValue = sourceValue;
            TargetValue = targetValue;
            AbsoluteDifference = absoluteDifference;
            AllowedDifference = allowedDifference;
            Basis = basis ?? "";
            Status = status ?? CrossDrawingSemanticStatus.Possible;
        }

        public string Metric { get; private set; }
        public double SourceValue { get; private set; }
        public double TargetValue { get; private set; }
        public double AbsoluteDifference { get; private set; }
        public double AllowedDifference { get; private set; }
        public string Basis { get; private set; }
        public string Status { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "metric", Metric,
                "source_value", SourceValue,
                "target_value", TargetValue,
                "absolute_difference", AbsoluteDifference,
                "allowed_difference", AllowedDifference,
                "basis", Basis,
                "status", Status);
        }
    }

    public sealed class CrossDrawingInterfaceComparisonRecord
    {
        readonly List<CrossDrawingMetricComparisonRecord> metrics;
        readonly List<string> support;
        readonly List<string> conflicts;
        readonly List<string> alternatives;

        internal CrossDrawingInterfaceComparisonRecord(
            string referenceId,
            string sourceDrawingId,
            string targetDrawingId,
            string sourceInterfaceId,
            string targetInterfaceId,
            string status,
            double score,
            string resolution,
            IEnumerable<CrossDrawingMetricComparisonRecord> metricValues,
            IEnumerable<string> supportValues,
            IEnumerable<string> conflictValues,
            IEnumerable<string> alternativeValues,
            double? localDirectionDelta)
        {
            ReferenceId = referenceId ?? "";
            SourceDrawingId = sourceDrawingId ?? "";
            TargetDrawingId = targetDrawingId ?? "";
            SourceInterfaceId = sourceInterfaceId ?? "";
            TargetInterfaceId = targetInterfaceId ?? "";
            Status = status ?? CrossDrawingSemanticStatus.Possible;
            Score = score;
            Resolution = resolution ?? "";
            metrics = metricValues == null
                ? new List<CrossDrawingMetricComparisonRecord>()
                : metricValues.OrderBy(value => value.Metric, StringComparer.Ordinal).ToList();
            support = CrossDrawingMaps.SortedUnique(supportValues, StringComparer.Ordinal);
            conflicts = CrossDrawingMaps.SortedUnique(conflictValues, StringComparer.Ordinal);
            alternatives = CrossDrawingMaps.SortedUnique(alternativeValues, StringComparer.Ordinal);
            HasLocalDirectionDelta = localDirectionDelta.HasValue;
            LocalDirectionDeltaDegrees = localDirectionDelta.GetValueOrDefault();
            Id = "interface-comparison:" + CrossDrawingMaps.Hash(
                ReferenceId, SourceInterfaceId, TargetInterfaceId, Status);
        }

        public string Id { get; private set; }
        public string ReferenceId { get; private set; }
        public string SourceDrawingId { get; private set; }
        public string TargetDrawingId { get; private set; }
        public string SourceInterfaceId { get; private set; }
        public string TargetInterfaceId { get; private set; }
        public string Status { get; private set; }
        public double Score { get; private set; }
        public string Resolution { get; private set; }
        public bool HasLocalDirectionDelta { get; private set; }
        public double LocalDirectionDeltaDegrees { get; private set; }
        public IList<CrossDrawingMetricComparisonRecord> Metrics { get { return metrics.AsReadOnly(); } }
        public IList<string> Support { get { return support.AsReadOnly(); } }
        public IList<string> Conflicts { get { return conflicts.AsReadOnly(); } }
        public IList<string> AlternativeTargetInterfaceIds { get { return alternatives.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "comparison_id", Id,
                "component_reference_id", ReferenceId,
                "source_drawing_node_id", SourceDrawingId,
                "target_drawing_node_id", TargetDrawingId,
                "source_interface_reference_id", SourceInterfaceId,
                "target_interface_reference_id", TargetInterfaceId,
                "status", Status,
                "score", Score,
                "resolution", Resolution,
                "metric_comparisons", metrics.Select(value => value.ToMap()).ToList(),
                "support", new List<string>(support),
                "conflicts", new List<string>(conflicts),
                "alternative_target_interface_ids", new List<string>(alternatives),
                "local_direction_delta_degrees",
                    HasLocalDirectionDelta ? (object)LocalDirectionDeltaDegrees : null,
                "direction_interpretation",
                    "descriptive_only_without_a_proven_cross_view_transform");
        }
    }

    public sealed class CrossDrawingAuditRecord
    {
        readonly List<string> sourceIds;

        internal CrossDrawingAuditRecord(
            string code,
            string state,
            string severity,
            string status,
            string message,
            IEnumerable<string> sources)
        {
            Code = code ?? "";
            State = state ?? "open";
            Severity = severity ?? "review";
            Status = status ?? CrossDrawingSemanticStatus.Possible;
            Message = message ?? "";
            sourceIds = CrossDrawingMaps.SortedUnique(sources, StringComparer.Ordinal);
            Id = "cross-drawing-audit:" + CrossDrawingMaps.Hash(
                Code, Message, string.Join("|", sourceIds));
        }

        public string Id { get; private set; }
        public string Code { get; private set; }
        public string State { get; private set; }
        public string Severity { get; private set; }
        public string Status { get; private set; }
        public string Message { get; private set; }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "audit_id", Id,
                "code", Code,
                "state", State,
                "severity", Severity,
                "status", Status,
                "message", Message,
                "source_ids", new List<string>(sourceIds));
        }
    }

    public sealed class CrossDrawingDiagnosticRecord
    {
        internal CrossDrawingDiagnosticRecord(
            string code,
            string status,
            string sourceId,
            string message)
        {
            Code = code ?? "";
            Status = status ?? "ambiguous";
            SourceId = sourceId ?? "";
            Message = message ?? "";
        }

        public string Code { get; private set; }
        public string Status { get; private set; }
        public string SourceId { get; private set; }
        public string Message { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class CrossDrawingInterfaceGraphDocument
    {
        readonly List<CrossDrawingDrawingObservation> drawings;
        readonly List<CrossDrawingRelationRecord> relations;
        readonly List<CrossDrawingIdentityAssertionRecord> identities;
        readonly List<CrossDrawingInterfaceComparisonRecord> comparisons;
        readonly List<CrossDrawingAuditRecord> audits;
        readonly List<CrossDrawingDiagnosticRecord> diagnostics;

        internal CrossDrawingInterfaceGraphDocument(
            IEnumerable<CrossDrawingDrawingObservation> drawingValues,
            IEnumerable<CrossDrawingRelationRecord> relationValues,
            IEnumerable<CrossDrawingIdentityAssertionRecord> identityValues,
            IEnumerable<CrossDrawingInterfaceComparisonRecord> comparisonValues,
            IEnumerable<CrossDrawingAuditRecord> auditValues,
            IEnumerable<CrossDrawingDiagnosticRecord> diagnosticValues,
            long candidateComparisonCount,
            bool truncated)
        {
            drawings = drawingValues == null
                ? new List<CrossDrawingDrawingObservation>()
                : drawingValues.OrderBy(value => value.NodeId, StringComparer.Ordinal).ToList();
            relations = relationValues == null
                ? new List<CrossDrawingRelationRecord>()
                : relationValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            identities = identityValues == null
                ? new List<CrossDrawingIdentityAssertionRecord>()
                : identityValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            comparisons = comparisonValues == null
                ? new List<CrossDrawingInterfaceComparisonRecord>()
                : comparisonValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            audits = auditValues == null
                ? new List<CrossDrawingAuditRecord>()
                : auditValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            diagnostics = diagnosticValues == null
                ? new List<CrossDrawingDiagnosticRecord>()
                : diagnosticValues.OrderBy(value => value.Code, StringComparer.Ordinal)
                    .ThenBy(value => value.SourceId, StringComparer.Ordinal).ToList();
            CandidateComparisonCount = candidateComparisonCount;
            Truncated = truncated;
            ProjectId = "drawing-project:" + CrossDrawingMaps.Hash(
                string.Join("|", drawings.Select(value => value.SnapshotId)));
        }

        public string ProjectId { get; private set; }
        public long CandidateComparisonCount { get; private set; }
        public bool Truncated { get; private set; }
        public IList<CrossDrawingDrawingObservation> Drawings { get { return drawings.AsReadOnly(); } }
        public IList<CrossDrawingRelationRecord> Relations { get { return relations.AsReadOnly(); } }
        public IList<CrossDrawingIdentityAssertionRecord> IdentityAssertions { get { return identities.AsReadOnly(); } }
        public IList<CrossDrawingInterfaceComparisonRecord> InterfaceComparisons { get { return comparisons.AsReadOnly(); } }
        public IList<CrossDrawingAuditRecord> Audits { get { return audits.AsReadOnly(); } }
        public IList<CrossDrawingDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }
        public int DrawingReferenceCount { get { return relations.Count(value => value.RelationType == "drawing_ref"); } }
        public int ComponentReferenceCount { get { return drawings.Sum(value => value.ComponentReferences.Count); } }
        public int InterfaceReferenceCount { get { return drawings.Sum(value => value.Interfaces.Count); } }
        public int SupportedIdentityCount { get { return identities.Count(value => value.Status == CrossDrawingSemanticStatus.Supported); } }
        public int PossibleIdentityCount { get { return identities.Count(value => value.Status == CrossDrawingSemanticStatus.Possible); } }
        public int ConflictedIdentityCount { get { return identities.Count(value => value.Status == CrossDrawingSemanticStatus.Conflicted); } }
        public int UnresolvedIdentityCount { get { return identities.Count(value => value.Status == CrossDrawingSemanticStatus.Unresolved); } }
        public string Status
        {
            get
            {
                if (Truncated || drawings.Any(value => value.Truncated
                    || value.SourceStatus == "unsupported_partial"))
                {
                    return "unsupported_partial";
                }
                if (audits.Any(value => value.Status == CrossDrawingSemanticStatus.Conflicted)
                    || identities.Any(value => value.Status == CrossDrawingSemanticStatus.Conflicted))
                {
                    return "conflicted";
                }
                if (identities.Any(value => value.Status == CrossDrawingSemanticStatus.Possible
                    || value.Status == CrossDrawingSemanticStatus.Unresolved)
                    || diagnostics.Any(value => value.Status == "ambiguous"))
                {
                    return "ambiguous";
                }
                return "computed";
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return CrossDrawingMaps.Map(
                "schema_version", "1",
                "analysis_type", "cross_drawing_interface_graph",
                "analyzer_version", "1",
                "project_id", ProjectId,
                "status", Status,
                "truncated", Truncated,
                "drawing_count", drawings.Count,
                "component_reference_count", ComponentReferenceCount,
                "interface_reference_count", InterfaceReferenceCount,
                "drawing_reference_relation_count", DrawingReferenceCount,
                "candidate_comparison_count", CandidateComparisonCount,
                "identity_counts", CrossDrawingMaps.Map(
                    "supported", SupportedIdentityCount,
                    "possible", PossibleIdentityCount,
                    "conflicted", ConflictedIdentityCount,
                    "unresolved", UnresolvedIdentityCount),
                "drawing_nodes", drawings.Select(value => CrossDrawingMaps.DrawingNodeMap(value)).ToList(),
                "component_reference_nodes", drawings.SelectMany(value => value.ComponentReferences.Select(reference =>
                    CrossDrawingMaps.ComponentNodeMap(value, reference))).ToList(),
                "interface_reference_nodes", drawings.SelectMany(value => value.Interfaces.Select(reference =>
                    CrossDrawingMaps.InterfaceNodeMap(value, reference))).ToList(),
                "relations", relations.Select(value => value.ToMap()).ToList(),
                "identity_assertions", identities.Select(value => value.ToMap()).ToList(),
                "interface_comparisons", comparisons.Select(value => value.ToMap()).ToList(),
                "audits", audits.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", CrossDrawingMaps.Map(
                    "scope", "facts_derived_from_a_supplied_drawing_set_not_enterprise_design_rules",
                    "drawing_identity", "authored_title_and_reference_codes_are_preserved_with_sheet_and_revision_ambiguity",
                    "component_identity", "exact_structured_reference_to_unique_title_identity_can_be_supported",
                    "interface_identity", "requires_reference_context_and_compatible_intrinsic_signature; geometry_similarity_alone_is_possible_only",
                    "geometry_scale", "raw_geometry_mismatch_is_not_a_proven_interface_conflict_without_comparable_scale evidence",
                    "missing_files", "absence_means_not_present_in_the_supplied_set_not_proven_absent_from_the_enterprise"),
                "mutation_status", "read_only_no_dwg_or_source_artifacts_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 跨图工程接口与项目关系");
            builder.AppendLine();
            builder.AppendLine("- 项目图：`" + ProjectId + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 图纸 / 构件引用 / 接口引用："
                + drawings.Count.ToString(CultureInfo.InvariantCulture) + " / "
                + ComponentReferenceCount.ToString(CultureInfo.InvariantCulture) + " / "
                + InterfaceReferenceCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 图纸引用关系 / 接口比较："
                + DrawingReferenceCount.ToString(CultureInfo.InvariantCulture) + " / "
                + comparisons.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 跨文件身份 SUPPORTED / POSSIBLE / CONFLICTED / UNRESOLVED："
                + SupportedIdentityCount.ToString(CultureInfo.InvariantCulture) + " / "
                + PossibleIdentityCount.ToString(CultureInfo.InvariantCulture) + " / "
                + ConflictedIdentityCount.ToString(CultureInfo.InvariantCulture) + " / "
                + UnresolvedIdentityCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 审计候选 / 诊断："
                + audits.Count.ToString(CultureInfo.InvariantCulture) + " / "
                + diagnostics.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("缺图只表示目标不在本次提供的图纸集合；接口几何相似只形成候选。只有结构化引用、唯一目标、明确接口上下文和可比签名共同成立时，接口身份才会升级为 SUPPORTED。");
            return builder.ToString().TrimEnd();
        }
    }

    internal static class CrossDrawingMaps
    {
        internal static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[Convert.ToString(values[index], CultureInfo.InvariantCulture)] = values[index + 1];
            }
            return result;
        }

        internal static string NormalizeIdentity(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) { return ""; }
            var builder = new StringBuilder(value.Length);
            foreach (char item in value.Trim().ToUpperInvariant())
            {
                if (char.IsLetterOrDigit(item)) { builder.Append(item); }
            }
            return builder.ToString();
        }

        internal static bool LooksLikeDrawingCode(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) { return false; }
            int separators = value.Count(item => item == '.' || item == '-' || item == '/');
            return separators >= 2
                && value.Any(char.IsLetter)
                && value.Any(char.IsDigit)
                && NormalizeIdentity(value).Length >= 7;
        }

        internal static string Hash(params string[] values)
        {
            using (SHA256 sha = SHA256.Create())
            {
                string joined = string.Join("\u001f", values ?? new string[0]);
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(joined));
                var builder = new StringBuilder(32);
                for (int index = 0; index < 16; index++)
                {
                    builder.Append(bytes[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }

        internal static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        internal static void AddUnique(List<string> values, string value, StringComparer comparer)
        {
            if (values == null || string.IsNullOrWhiteSpace(value)) { return; }
            if (!values.Any(item => comparer.Equals(item, value)))
            {
                values.Add(value);
                values.Sort(comparer);
            }
        }

        internal static List<string> SortedUnique(
            IEnumerable<string> values,
            StringComparer comparer)
        {
            var result = new List<string>();
            if (values == null) { return result; }
            foreach (string value in values) { AddUnique(result, value, comparer); }
            return result;
        }

        internal static string StrongerStatus(string left, string right)
        {
            string a = string.IsNullOrWhiteSpace(left) ? CrossDrawingSemanticStatus.Unresolved : left;
            string b = string.IsNullOrWhiteSpace(right) ? CrossDrawingSemanticStatus.Unresolved : right;
            if (a == CrossDrawingSemanticStatus.Conflicted || b == CrossDrawingSemanticStatus.Conflicted)
            {
                return CrossDrawingSemanticStatus.Conflicted;
            }
            if (a == CrossDrawingSemanticStatus.Supported || b == CrossDrawingSemanticStatus.Supported)
            {
                return CrossDrawingSemanticStatus.Supported;
            }
            if (a == CrossDrawingSemanticStatus.Possible || b == CrossDrawingSemanticStatus.Possible)
            {
                return CrossDrawingSemanticStatus.Possible;
            }
            return CrossDrawingSemanticStatus.Unresolved;
        }

        internal static Dictionary<string, object> DrawingNodeMap(
            CrossDrawingDrawingObservation value)
        {
            return Map(
                "node_id", value.NodeId,
                "node_type", "drawing_ref",
                "snapshot_id", value.SnapshotId,
                "drawing_id", value.DrawingId,
                "drawing_number", value.DrawingNumber,
                "normalized_drawing_number", value.NormalizedDrawingNumber,
                "drawing_name", value.DrawingName,
                "revision", value.Revision,
                "stage", value.Stage,
                "sheet", value.Sheet,
                "sheet_count", value.SheetCount,
                "drawing_key", value.DrawingKey,
                "source_path", value.SourcePath,
                "source_status", value.SourceStatus,
                "truncated", value.Truncated,
                "unit_name", value.UnitName,
                "measurement_system", value.MeasurementSystem,
                "comparable_geometry_scale_proven", value.ComparableGeometryScaleProven,
                "geometry_scale_evidence", value.GeometryScaleEvidence,
                "source_snapshot_ids", new[] { value.SnapshotId });
        }

        internal static Dictionary<string, object> ComponentNodeMap(
            CrossDrawingDrawingObservation drawing,
            CrossDrawingComponentReferenceObservation value)
        {
            Dictionary<string, object> map = value.ToMap();
            map["node_id"] = value.Id;
            map["node_type"] = "component_ref";
            map["source_drawing_node_id"] = drawing.NodeId;
            map["source_snapshot_ids"] = new[] { drawing.SnapshotId };
            return map;
        }

        internal static Dictionary<string, object> InterfaceNodeMap(
            CrossDrawingDrawingObservation drawing,
            CrossDrawingInterfaceObservation value)
        {
            Dictionary<string, object> map = value.ToMap();
            map["node_id"] = value.Id;
            map["node_type"] = "interface_ref";
            map["source_drawing_node_id"] = drawing.NodeId;
            map["source_snapshot_ids"] = new[] { drawing.SnapshotId };
            return map;
        }
    }
}
