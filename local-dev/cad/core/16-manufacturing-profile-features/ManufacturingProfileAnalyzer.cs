using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class ManufacturingProfileConfig
    {
        public ManufacturingProfileConfig()
        {
            MinimumFaceAreaRatio = 0.0000000001;
            CircularityThreshold = 0.82;
            MaximumCircularRadialVariation = 0.08;
            RectangularityThreshold = 0.94;
            MinimumRightAngleRatio = 0.75;
            ElongatedAspectRatio = 2.0;
            FeatureSizeToleranceRatio = 0.0025;
            MinimumRepeatedFeatureCount = 2;
            MaximumFaceCandidateCount = 100000;
            MaximumAdjacencyCount = 200000;
        }

        public double MinimumFaceAreaRatio { get; set; }
        public double CircularityThreshold { get; set; }
        public double MaximumCircularRadialVariation { get; set; }
        public double RectangularityThreshold { get; set; }
        public double MinimumRightAngleRatio { get; set; }
        public double ElongatedAspectRatio { get; set; }
        public double FeatureSizeToleranceRatio { get; set; }
        public int MinimumRepeatedFeatureCount { get; set; }
        public int MaximumFaceCandidateCount { get; set; }
        public int MaximumAdjacencyCount { get; set; }
    }

    public sealed class ManufacturingProfileRecord
    {
        readonly List<string> boundaryVertexIds;
        readonly List<string> boundaryEdgeIds;
        readonly List<string> sourceOccurrenceIds;
        readonly List<string> sourceHandles;
        readonly List<string> sourceRoles;
        readonly List<string> parentProfileIds;
        readonly List<string> voidBoundaryIds;

        internal ManufacturingProfileRecord(
            string id,
            string faceId,
            string regionId,
            string objectClusterId,
            string profileRole,
            string shapeClass,
            string status,
            string boundaryQuality,
            double centerX,
            double centerY,
            double minX,
            double minY,
            double maxX,
            double maxY,
            double orientedWidth,
            double orientedHeight,
            double orientationDegrees,
            double grossArea,
            double netArea,
            double perimeter,
            double circularity,
            double rectangularity,
            double aspectRatio,
            double radialVariation,
            double rightAngleRatio,
            int effectiveCornerCount,
            IEnumerable<string> vertices,
            IEnumerable<string> edges,
            IEnumerable<string> occurrences,
            IEnumerable<string> handles,
            IEnumerable<string> roles,
            IEnumerable<string> parents,
            IEnumerable<string> voids)
        {
            Id = id ?? "";
            FaceId = faceId ?? "";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            ProfileRole = profileRole ?? "bounded_profile_candidate";
            ShapeClass = shapeClass ?? "irregular_closed_profile";
            Status = status ?? "candidate";
            BoundaryQuality = boundaryQuality ?? "";
            CenterX = centerX;
            CenterY = centerY;
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            OrientedWidth = orientedWidth;
            OrientedHeight = orientedHeight;
            OrientationDegrees = orientationDegrees;
            GrossArea = grossArea;
            NetArea = netArea;
            Perimeter = perimeter;
            Circularity = circularity;
            Rectangularity = rectangularity;
            AspectRatio = aspectRatio;
            RadialVariation = radialVariation;
            RightAngleRatio = rightAngleRatio;
            EffectiveCornerCount = effectiveCornerCount;
            boundaryVertexIds = ManufacturingProfileMaps.SortedUniquePreserveOrder(vertices);
            boundaryEdgeIds = ManufacturingProfileMaps.SortedUnique(edges);
            sourceOccurrenceIds = ManufacturingProfileMaps.SortedUnique(occurrences);
            sourceHandles = ManufacturingProfileMaps.SortedUnique(handles);
            sourceRoles = ManufacturingProfileMaps.SortedUnique(roles);
            parentProfileIds = ManufacturingProfileMaps.SortedUnique(parents);
            voidBoundaryIds = ManufacturingProfileMaps.SortedUnique(voids);
        }

        public string Id { get; private set; }
        public string FaceId { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string ProfileRole { get; private set; }
        public string ShapeClass { get; private set; }
        public string Status { get; private set; }
        public string BoundaryQuality { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public double OrientedWidth { get; private set; }
        public double OrientedHeight { get; private set; }
        public double OrientationDegrees { get; private set; }
        public double GrossArea { get; private set; }
        public double NetArea { get; private set; }
        public double Perimeter { get; private set; }
        public double Circularity { get; private set; }
        public double Rectangularity { get; private set; }
        public double AspectRatio { get; private set; }
        public double RadialVariation { get; private set; }
        public double RightAngleRatio { get; private set; }
        public int EffectiveCornerCount { get; private set; }
        public IList<string> BoundaryVertexIds { get { return boundaryVertexIds.AsReadOnly(); } }
        public IList<string> BoundaryEdgeIds { get { return boundaryEdgeIds.AsReadOnly(); } }
        public IList<string> SourceOccurrenceIds { get { return sourceOccurrenceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public IList<string> SourceRoles { get { return sourceRoles.AsReadOnly(); } }
        public IList<string> ParentProfileIds { get { return parentProfileIds.AsReadOnly(); } }
        public IList<string> VoidBoundaryIds { get { return voidBoundaryIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "profile_id", Id,
                "face_id", FaceId,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "profile_role", ProfileRole,
                "shape_class", ShapeClass,
                "status", Status,
                "boundary_quality", BoundaryQuality,
                "center", new[] { CenterX, CenterY },
                "bounds", new[] { MinX, MinY, MaxX, MaxY },
                "width", Width,
                "height", Height,
                "oriented_extents", new[] { OrientedWidth, OrientedHeight },
                "orientation_degrees", OrientationDegrees,
                "gross_area", GrossArea,
                "net_area", NetArea,
                "perimeter", Perimeter,
                "circularity", Circularity,
                "rectangularity", Rectangularity,
                "aspect_ratio", AspectRatio,
                "radial_variation", RadialVariation,
                "right_angle_ratio", RightAngleRatio,
                "effective_corner_count", EffectiveCornerCount,
                "boundary_vertex_ids", new List<string>(boundaryVertexIds),
                "boundary_edge_ids", new List<string>(boundaryEdgeIds),
                "source_occurrence_ids", new List<string>(sourceOccurrenceIds),
                "source_handles", new List<string>(sourceHandles),
                "source_roles", new List<string>(sourceRoles),
                "parent_profile_ids", new List<string>(parentProfileIds),
                "void_boundary_ids", new List<string>(voidBoundaryIds),
                "manufacturing_interpretation", "profile_candidate_not_material_boundary_proof");
        }
    }

    public sealed class ManufacturingVoidBoundaryRecord
    {
        readonly List<string> boundaryVertexIds;
        readonly List<string> boundaryEdgeIds;
        readonly List<string> sourceOccurrenceIds;
        readonly List<string> sourceHandles;

        internal ManufacturingVoidBoundaryRecord(
            string id,
            string hostProfileId,
            string boundaryProfileId,
            string regionId,
            string objectClusterId,
            string shapeClass,
            string geometrySignature,
            string status,
            double centerX,
            double centerY,
            double minX,
            double minY,
            double maxX,
            double maxY,
            double orientedWidth,
            double orientedHeight,
            double orientationDegrees,
            double area,
            double perimeter,
            double circularity,
            double rectangularity,
            double aspectRatio,
            double radialVariation,
            int effectiveCornerCount,
            IEnumerable<string> vertices,
            IEnumerable<string> edges,
            IEnumerable<string> occurrences,
            IEnumerable<string> handles)
        {
            Id = id ?? "";
            HostProfileId = hostProfileId ?? "";
            BoundaryProfileId = boundaryProfileId ?? "";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            ShapeClass = shapeClass ?? "irregular_closed_profile";
            GeometrySignature = geometrySignature ?? "";
            Status = status ?? "candidate";
            CenterX = centerX;
            CenterY = centerY;
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            OrientedWidth = orientedWidth;
            OrientedHeight = orientedHeight;
            OrientationDegrees = orientationDegrees;
            Area = area;
            Perimeter = perimeter;
            Circularity = circularity;
            Rectangularity = rectangularity;
            AspectRatio = aspectRatio;
            RadialVariation = radialVariation;
            EffectiveCornerCount = effectiveCornerCount;
            boundaryVertexIds = ManufacturingProfileMaps.SortedUniquePreserveOrder(vertices);
            boundaryEdgeIds = ManufacturingProfileMaps.SortedUnique(edges);
            sourceOccurrenceIds = ManufacturingProfileMaps.SortedUnique(occurrences);
            sourceHandles = ManufacturingProfileMaps.SortedUnique(handles);
        }

        public string Id { get; private set; }
        public string HostProfileId { get; private set; }
        public string BoundaryProfileId { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string ShapeClass { get; private set; }
        public string GeometrySignature { get; private set; }
        public string Status { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public double OrientedWidth { get; private set; }
        public double OrientedHeight { get; private set; }
        public double OrientationDegrees { get; private set; }
        public double Area { get; private set; }
        public double Perimeter { get; private set; }
        public double Circularity { get; private set; }
        public double Rectangularity { get; private set; }
        public double AspectRatio { get; private set; }
        public double RadialVariation { get; private set; }
        public int EffectiveCornerCount { get; private set; }
        public IList<string> BoundaryVertexIds { get { return boundaryVertexIds.AsReadOnly(); } }
        public IList<string> BoundaryEdgeIds { get { return boundaryEdgeIds.AsReadOnly(); } }
        public IList<string> SourceOccurrenceIds { get { return sourceOccurrenceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "void_boundary_id", Id,
                "host_profile_id", HostProfileId,
                "boundary_profile_id", BoundaryProfileId,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "shape_class", ShapeClass,
                "geometry_signature", GeometrySignature,
                "status", Status,
                "center", new[] { CenterX, CenterY },
                "bounds", new[] { MinX, MinY, MaxX, MaxY },
                "width", Width,
                "height", Height,
                "oriented_extents", new[] { OrientedWidth, OrientedHeight },
                "orientation_degrees", OrientationDegrees,
                "area", Area,
                "perimeter", Perimeter,
                "circularity", Circularity,
                "rectangularity", Rectangularity,
                "aspect_ratio", AspectRatio,
                "radial_variation", RadialVariation,
                "effective_corner_count", EffectiveCornerCount,
                "boundary_vertex_ids", new List<string>(boundaryVertexIds),
                "boundary_edge_ids", new List<string>(boundaryEdgeIds),
                "source_occurrence_ids", new List<string>(sourceOccurrenceIds),
                "source_handles", new List<string>(sourceHandles),
                "semantic_boundary", "void_or_nested_part_candidate_not_through_hole_proof");
        }
    }

    public sealed class ManufacturingProfileAdjacencyRecord
    {
        readonly List<string> sharedEdgeIds;

        internal ManufacturingProfileAdjacencyRecord(
            string id,
            string relationType,
            string leftProfileId,
            string rightProfileId,
            IEnumerable<string> edges,
            double sharedLength,
            string status)
        {
            Id = id ?? "";
            RelationType = relationType ?? "";
            LeftProfileId = leftProfileId ?? "";
            RightProfileId = rightProfileId ?? "";
            sharedEdgeIds = ManufacturingProfileMaps.SortedUnique(edges);
            SharedBoundaryLength = sharedLength;
            Status = status ?? "candidate";
        }

        public string Id { get; private set; }
        public string RelationType { get; private set; }
        public string LeftProfileId { get; private set; }
        public string RightProfileId { get; private set; }
        public IList<string> SharedEdgeIds { get { return sharedEdgeIds.AsReadOnly(); } }
        public double SharedBoundaryLength { get; private set; }
        public string Status { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "adjacency_id", Id,
                "relation_type", RelationType,
                "left_profile_id", LeftProfileId,
                "right_profile_id", RightProfileId,
                "shared_edge_ids", new List<string>(sharedEdgeIds),
                "shared_boundary_length", SharedBoundaryLength,
                "status", Status,
                "physical_adjacency_inference", "not_inferred_from_drawing_face_adjacency_alone");
        }
    }

    public sealed class RepeatedManufacturingFeatureGroupRecord
    {
        readonly List<string> featureIds;
        readonly List<double[]> centers;
        readonly List<double> spacings;

        internal RepeatedManufacturingFeatureGroupRecord(
            string id,
            string regionId,
            string objectClusterId,
            string shapeClass,
            string geometrySignature,
            string alignment,
            IEnumerable<string> features,
            IEnumerable<double[]> centerValues,
            IEnumerable<double> spacingValues)
        {
            Id = id ?? "";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            ShapeClass = shapeClass ?? "";
            GeometrySignature = geometrySignature ?? "";
            Alignment = alignment ?? "distributed_in_local_frame";
            featureIds = ManufacturingProfileMaps.SortedUnique(features);
            centers = centerValues == null
                ? new List<double[]>()
                : centerValues.Select(value => new[] { value[0], value[1] }).ToList();
            spacings = spacingValues == null
                ? new List<double>()
                : spacingValues.OrderBy(value => value).ToList();
        }

        public string Id { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string ShapeClass { get; private set; }
        public string GeometrySignature { get; private set; }
        public string Alignment { get; private set; }
        public IList<string> FeatureIds { get { return featureIds.AsReadOnly(); } }
        public IList<double[]> Centers { get { return centers.AsReadOnly(); } }
        public IList<double> ConsecutiveSpacings { get { return spacings.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "repeated_feature_group_id", Id,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "shape_class", ShapeClass,
                "geometry_signature", GeometrySignature,
                "alignment", Alignment,
                "feature_ids", new List<string>(featureIds),
                "feature_count", featureIds.Count,
                "centers", centers.Select(value => new[] { value[0], value[1] }).ToList(),
                "consecutive_spacings", new List<double>(spacings),
                "semantic_boundary", "repeated_geometry_not_fastener_or_hole_count_proof");
        }
    }

    public sealed class OpenManufacturingBoundaryRecord
    {
        readonly List<string> edgeIds;
        readonly List<string> sourceOccurrenceIds;
        readonly List<string> sourceHandles;

        internal OpenManufacturingBoundaryRecord(
            string id,
            string componentId,
            string regionId,
            string objectClusterId,
            string kind,
            int endpointCount,
            int branchCount,
            IEnumerable<string> edges,
            IEnumerable<string> occurrences,
            IEnumerable<string> handles)
        {
            Id = id ?? "";
            ComponentId = componentId ?? "";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            Kind = kind ?? "open_network_candidate";
            EndpointCount = endpointCount;
            BranchVertexCount = branchCount;
            edgeIds = ManufacturingProfileMaps.SortedUnique(edges);
            sourceOccurrenceIds = ManufacturingProfileMaps.SortedUnique(occurrences);
            sourceHandles = ManufacturingProfileMaps.SortedUnique(handles);
        }

        public string Id { get; private set; }
        public string ComponentId { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string Kind { get; private set; }
        public int EndpointCount { get; private set; }
        public int BranchVertexCount { get; private set; }
        public IList<string> EdgeIds { get { return edgeIds.AsReadOnly(); } }
        public IList<string> SourceOccurrenceIds { get { return sourceOccurrenceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "open_boundary_id", Id,
                "component_id", ComponentId,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "kind", Kind,
                "endpoint_count", EndpointCount,
                "branch_vertex_count", BranchVertexCount,
                "edge_ids", new List<string>(edgeIds),
                "source_occurrence_ids", new List<string>(sourceOccurrenceIds),
                "source_handles", new List<string>(sourceHandles),
                "status", "observed_open_topology_not_automatically_a_defect",
                "gap_bridge_status", "not_attempted_source_geometry_unchanged");
        }
    }

    public sealed class ManufacturingObjectProfileSummaryRecord
    {
        readonly List<string> representationIds;
        readonly List<string> regionIds;
        readonly List<string> profileIds;
        readonly List<string> voidBoundaryIds;
        readonly List<string> repeatedGroupIds;
        readonly List<string> openBoundaryIds;

        internal ManufacturingObjectProfileSummaryRecord(
            string clusterId,
            IEnumerable<string> representations,
            IEnumerable<string> regions,
            IEnumerable<string> profiles,
            IEnumerable<string> voids,
            IEnumerable<string> repeats,
            IEnumerable<string> opens)
        {
            PhysicalObjectClusterId = clusterId ?? "";
            representationIds = ManufacturingProfileMaps.SortedUnique(representations);
            regionIds = ManufacturingProfileMaps.SortedUnique(regions);
            profileIds = ManufacturingProfileMaps.SortedUnique(profiles);
            voidBoundaryIds = ManufacturingProfileMaps.SortedUnique(voids);
            repeatedGroupIds = ManufacturingProfileMaps.SortedUnique(repeats);
            openBoundaryIds = ManufacturingProfileMaps.SortedUnique(opens);
        }

        public string PhysicalObjectClusterId { get; private set; }
        public IList<string> RepresentationIds { get { return representationIds.AsReadOnly(); } }
        public IList<string> RegionIds { get { return regionIds.AsReadOnly(); } }
        public IList<string> ProfileIds { get { return profileIds.AsReadOnly(); } }
        public IList<string> VoidBoundaryIds { get { return voidBoundaryIds.AsReadOnly(); } }
        public IList<string> RepeatedFeatureGroupIds { get { return repeatedGroupIds.AsReadOnly(); } }
        public IList<string> OpenBoundaryIds { get { return openBoundaryIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "representation_ids", new List<string>(representationIds),
                "region_ids", new List<string>(regionIds),
                "profile_ids", new List<string>(profileIds),
                "profile_count", profileIds.Count,
                "void_boundary_ids", new List<string>(voidBoundaryIds),
                "repeated_feature_group_ids", new List<string>(repeatedGroupIds),
                "open_boundary_ids", new List<string>(openBoundaryIds),
                "cross_view_fusion_status", "view_scoped_candidates_not_geometrically_fused");
        }
    }

    public sealed class ManufacturingProfileDiagnosticRecord
    {
        internal ManufacturingProfileDiagnosticRecord(
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
            return ManufacturingProfileMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class ManufacturingProfileFeatureDocument
    {
        readonly List<ManufacturingProfileRecord> profiles;
        readonly List<ManufacturingVoidBoundaryRecord> voidBoundaries;
        readonly List<ManufacturingProfileAdjacencyRecord> adjacencies;
        readonly List<RepeatedManufacturingFeatureGroupRecord> repeatedGroups;
        readonly List<OpenManufacturingBoundaryRecord> openBoundaries;
        readonly List<ManufacturingObjectProfileSummaryRecord> objectSummaries;
        readonly List<ManufacturingProfileDiagnosticRecord> diagnostics;

        internal ManufacturingProfileFeatureDocument(
            string drawingId,
            string topologyStatus,
            string identityStatus,
            int inputFaceCount,
            int unassignedFaceCount,
            IEnumerable<ManufacturingProfileRecord> profileValues,
            IEnumerable<ManufacturingVoidBoundaryRecord> voidValues,
            IEnumerable<ManufacturingProfileAdjacencyRecord> adjacencyValues,
            IEnumerable<RepeatedManufacturingFeatureGroupRecord> repeatedValues,
            IEnumerable<OpenManufacturingBoundaryRecord> openValues,
            IEnumerable<ManufacturingObjectProfileSummaryRecord> summaryValues,
            IEnumerable<ManufacturingProfileDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            SourceTopologyStatus = topologyStatus ?? "";
            SourceIdentityStatus = identityStatus ?? "";
            InputFaceCount = inputFaceCount;
            UnassignedFaceCount = unassignedFaceCount;
            profiles = Copy(profileValues);
            voidBoundaries = Copy(voidValues);
            adjacencies = Copy(adjacencyValues);
            repeatedGroups = Copy(repeatedValues);
            openBoundaries = Copy(openValues);
            objectSummaries = Copy(summaryValues);
            diagnostics = Copy(diagnosticValues);
            Status = diagnostics.Any(value => value.Status == "unsupported")
                || SourceTopologyStatus == "unsupported_partial"
                    ? "unsupported_partial"
                    : diagnostics.Any(value => value.Status == "ambiguous")
                        || SourceTopologyStatus == "ambiguous"
                            ? "ambiguous"
                            : "computed";
        }

        public string DrawingId { get; private set; }
        public string Status { get; private set; }
        public string SourceTopologyStatus { get; private set; }
        public string SourceIdentityStatus { get; private set; }
        public int InputFaceCount { get; private set; }
        public int UnassignedFaceCount { get; private set; }
        public IList<ManufacturingProfileRecord> Profiles { get { return profiles.AsReadOnly(); } }
        public IList<ManufacturingVoidBoundaryRecord> VoidBoundaries { get { return voidBoundaries.AsReadOnly(); } }
        public IList<ManufacturingProfileAdjacencyRecord> Adjacencies { get { return adjacencies.AsReadOnly(); } }
        public IList<RepeatedManufacturingFeatureGroupRecord> RepeatedFeatureGroups { get { return repeatedGroups.AsReadOnly(); } }
        public IList<OpenManufacturingBoundaryRecord> OpenBoundaries { get { return openBoundaries.AsReadOnly(); } }
        public IList<ManufacturingObjectProfileSummaryRecord> ObjectSummaries { get { return objectSummaries.AsReadOnly(); } }
        public IList<ManufacturingProfileDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }
        public int CircularVoidBoundaryCount
        {
            get { return voidBoundaries.Count(value => value.ShapeClass == "circular_closed_profile"); }
        }

        public Dictionary<string, object> ToMap()
        {
            return ManufacturingProfileMaps.Map(
                "schema_version", "1",
                "analysis_type", "manufacturing_profile_features",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "source_topology_status", SourceTopologyStatus,
                "source_identity_status", SourceIdentityStatus,
                "input_face_count", InputFaceCount,
                "assigned_profile_count", profiles.Count,
                "unassigned_face_count", UnassignedFaceCount,
                "void_boundary_candidate_count", voidBoundaries.Count,
                "circular_void_boundary_candidate_count", CircularVoidBoundaryCount,
                "profile_adjacency_count", adjacencies.Count,
                "repeated_feature_group_count", repeatedGroups.Count,
                "open_boundary_candidate_count", openBoundaries.Count,
                "object_summary_count", objectSummaries.Count,
                "profiles", profiles.Select(value => value.ToMap()).ToList(),
                "void_boundaries", voidBoundaries.Select(value => value.ToMap()).ToList(),
                "profile_adjacencies", adjacencies.Select(value => value.ToMap()).ToList(),
                "repeated_feature_groups", repeatedGroups.Select(value => value.ToMap()).ToList(),
                "open_boundaries", openBoundaries.Select(value => value.ToMap()).ToList(),
                "object_summaries", objectSummaries.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", ManufacturingProfileMaps.Map(
                    "bounded_dcel_face", "profile_candidate_not_manufactured_material_proof",
                    "nested_boundary", "void_or_nested_part_candidate_not_through_hole_proof",
                    "circularity", "shape_evidence_not_hole_semantics",
                    "repetition", "geometry_pattern_not_fastener_or_quantity_semantics",
                    "open_component", "observed_topology_not_automatically_a_defect",
                    "cross_view", "summarized_by_identity_cluster_not_geometrically_fused"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 制造轮廓与孔槽候选");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`（源拓扑：`" + SourceTopologyStatus + "`）");
            builder.AppendLine("- 已归属轮廓 / 未归属面："
                + profiles.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + UnassignedFaceCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 内嵌边界 / 圆形内嵌边界："
                + voidBoundaries.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + CircularVoidBoundaryCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 重复特征组 / 开放拓扑候选："
                + repeatedGroups.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + openBoundaries.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("有界面、内嵌圆和重复图案都只是可回链的几何候选；没有剖视、尺寸、中心或业务证据时，不直接称为材料外轮廓、通孔、槽或数量。");
            return builder.ToString().TrimEnd();
        }

        static List<T> Copy<T>(IEnumerable<T> values)
        {
            return values == null ? new List<T>() : values.ToList();
        }
    }

    public static class ManufacturingProfileAnalyzer
    {
        sealed class ShapeMetrics
        {
            public double CenterX;
            public double CenterY;
            public double MinX;
            public double MinY;
            public double MaxX;
            public double MaxY;
            public double OrientedWidth;
            public double OrientedHeight;
            public double OrientationDegrees;
            public double Area;
            public double Perimeter;
            public double Circularity;
            public double Rectangularity;
            public double AspectRatio;
            public double RadialVariation;
            public double RightAngleRatio;
            public int EffectiveCornerCount;
            public string ShapeClass;
        }

        sealed class ProfileBuilder
        {
            public string Id;
            public PlanarFaceRecord Face;
            public EngineeringViewRegionRecord Region;
            public string ClusterId;
            public ShapeMetrics Metrics;
            public List<string> BoundaryEdgeIds = new List<string>();
            public List<string> OccurrenceIds = new List<string>();
            public List<string> Handles = new List<string>();
            public List<string> Roles = new List<string>();
            public List<string> ParentIds = new List<string>();
            public List<string> VoidIds = new List<string>();
            public string BoundaryQuality;
        }

        public static ManufacturingProfileFeatureDocument Analyze(
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            RepresentationIdentityResolutionDocument identity,
            ManufacturingProfileConfig config = null)
        {
            if (regions == null) { throw new ArgumentNullException("regions"); }
            if (topology == null) { throw new ArgumentNullException("topology"); }
            if (identity == null) { throw new ArgumentNullException("identity"); }
            config = config ?? new ManufacturingProfileConfig();
            ValidateConfig(config);

            var diagnostics = new List<ManufacturingProfileDiagnosticRecord>();
            if (!SameDrawing(regions.DrawingId, topology.DrawingId)
                || !SameDrawing(regions.DrawingId, identity.DrawingId))
            {
                diagnostics.Add(new ManufacturingProfileDiagnosticRecord(
                    "DRAWING_ID_MISMATCH", "unsupported", regions.DrawingId,
                    "Region, topology, and identity documents must describe the same drawing."));
            }

            var vertices = topology.Vertices.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var edges = topology.Edges.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var components = topology.Components.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var edgeByPair = new Dictionary<string, PlanarEdgeRecord>(StringComparer.Ordinal);
            foreach (PlanarEdgeRecord edge in topology.Edges)
            {
                edgeByPair[PairKey(edge.StartVertexId, edge.EndVertexId)] = edge;
            }
            List<EngineeringViewRegionRecord> viewRegions = regions.Regions
                .Where(value => value != null && value.IsEngineeringView)
                .OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            var regionVertexSets = viewRegions.ToDictionary(
                value => value.Id,
                value => new HashSet<string>(value.VertexIds, StringComparer.Ordinal),
                StringComparer.Ordinal);
            var regionsByVertex = new Dictionary<string, List<EngineeringViewRegionRecord>>(StringComparer.Ordinal);
            foreach (EngineeringViewRegionRecord region in viewRegions)
            {
                foreach (string vertexId in region.VertexIds)
                {
                    List<EngineeringViewRegionRecord> values;
                    if (!regionsByVertex.TryGetValue(vertexId, out values))
                    {
                        values = new List<EngineeringViewRegionRecord>();
                        regionsByVertex[vertexId] = values;
                    }
                    values.Add(region);
                }
            }
            Dictionary<string, string> clusterByRegion = BuildClusterByRegion(identity, diagnostics);

            var builders = new List<ProfileBuilder>();
            bool faceLimitReached = false;
            foreach (PlanarFaceRecord face in topology.Faces.OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (builders.Count >= config.MaximumFaceCandidateCount)
                {
                    faceLimitReached = true;
                    break;
                }
                if (face.OuterVertexIds.Count < 3) { continue; }
                List<EngineeringViewRegionRecord> ownerCandidates;
                if (!regionsByVertex.TryGetValue(face.OuterVertexIds[0], out ownerCandidates)) { continue; }
                List<EngineeringViewRegionRecord> owners = ownerCandidates.Where(region =>
                    face.OuterVertexIds.All(regionVertexSets[region.Id].Contains))
                    .Distinct().OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
                if (owners.Count == 0) { continue; }
                if (owners.Count > 1)
                {
                    diagnostics.Add(new ManufacturingProfileDiagnosticRecord(
                        "FACE_ASSIGNED_TO_MULTIPLE_VIEW_REGIONS", "ambiguous", face.Id,
                        "A bounded face is fully contained in more than one engineering-region vertex set; the smallest region was selected."));
                    owners = owners.OrderBy(value => value.Area).ThenBy(value => value.Id, StringComparer.Ordinal).ToList();
                }
                EngineeringViewRegionRecord owner = owners[0];
                double minimumArea = Math.Max(
                    topology.GridSize * topology.GridSize,
                    Math.Max(owner.Area, 1) * config.MinimumFaceAreaRatio);
                if (face.GrossArea < minimumArea) { continue; }
                ShapeMetrics metrics = Measure(face.OuterVertexIds, vertices, face.GrossArea, face.Perimeter, config);
                if (metrics == null)
                {
                    diagnostics.Add(new ManufacturingProfileDiagnosticRecord(
                        "FACE_VERTEX_EVIDENCE_MISSING", "unsupported", face.Id,
                        "A face references missing or degenerate boundary vertices and was ignored."));
                    continue;
                }
                List<string> boundaryEdges = BoundaryEdges(face.OuterVertexIds, edgeByPair);
                List<PlanarEdgeSupportRecord> supports = boundaryEdges
                    .Where(edges.ContainsKey)
                    .SelectMany(value => edges[value].Supports).ToList();
                string clusterId;
                clusterByRegion.TryGetValue(owner.Id, out clusterId);
                builders.Add(new ProfileBuilder
                {
                    Id = "manufacturing-profile:" + Hash(new[] { regions.DrawingId, owner.Id, face.Id }),
                    Face = face,
                    Region = owner,
                    ClusterId = clusterId ?? "",
                    Metrics = metrics,
                    BoundaryEdgeIds = boundaryEdges,
                    OccurrenceIds = supports.Select(value => value.OccurrenceId).ToList(),
                    Handles = supports.Select(value => value.SourceHandle).ToList(),
                    Roles = supports.Select(value => value.SemanticRole).ToList(),
                    BoundaryQuality = BoundaryQuality(supports)
                });
            }
            if (faceLimitReached)
            {
                diagnostics.Add(new ManufacturingProfileDiagnosticRecord(
                    "FACE_CANDIDATE_LIMIT_REACHED", "unsupported", "",
                    "Manufacturing profile candidates were truncated at the configured limit."));
            }

            var buildersByVertexSet = builders.GroupBy(value => VertexSetKey(value.Face.OuterVertexIds), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
            var voidBoundaries = new List<ManufacturingVoidBoundaryRecord>();
            var adjacencyBuilders = new Dictionary<string, ManufacturingProfileAdjacencyRecord>(StringComparer.Ordinal);
            foreach (ProfileBuilder host in builders.OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                int holeIndex = 0;
                foreach (IList<string> holeVertices in host.Face.HoleVertexIds)
                {
                    if (holeVertices == null || holeVertices.Count < 3) { continue; }
                    ShapeMetrics metrics = Measure(holeVertices, vertices, null, null, config);
                    if (metrics == null) { continue; }
                    List<string> holeEdges = BoundaryEdges(holeVertices, edgeByPair);
                    List<PlanarEdgeSupportRecord> supports = holeEdges
                        .Where(edges.ContainsKey)
                        .SelectMany(value => edges[value].Supports).ToList();
                    ProfileBuilder child = null;
                    List<ProfileBuilder> matches;
                    if (buildersByVertexSet.TryGetValue(VertexSetKey(holeVertices), out matches))
                    {
                        child = matches.Where(value => value.Region.Id == host.Region.Id)
                            .OrderBy(value => value.Id, StringComparer.Ordinal).FirstOrDefault();
                    }
                    string voidId = "manufacturing-void-boundary:" + Hash(new[]
                    {
                        host.Id,
                        holeIndex.ToString(CultureInfo.InvariantCulture),
                        string.Join("|", holeVertices.OrderBy(value => value, StringComparer.Ordinal))
                    });
                    host.VoidIds.Add(voidId);
                    if (child != null && !child.ParentIds.Contains(host.Id)) { child.ParentIds.Add(host.Id); }
                    double tolerance = FeatureTolerance(host.Region, topology, config);
                    string signature = GeometrySignature(metrics, tolerance);
                    voidBoundaries.Add(new ManufacturingVoidBoundaryRecord(
                        voidId,
                        host.Id,
                        child == null ? "" : child.Id,
                        host.Region.Id,
                        host.ClusterId,
                        metrics.ShapeClass,
                        signature,
                        child == null
                            ? "nested_boundary_without_separate_face_match"
                            : "topology_nested_boundary_supported",
                        metrics.CenterX,
                        metrics.CenterY,
                        metrics.MinX,
                        metrics.MinY,
                        metrics.MaxX,
                        metrics.MaxY,
                        metrics.OrientedWidth,
                        metrics.OrientedHeight,
                        metrics.OrientationDegrees,
                        metrics.Area,
                        metrics.Perimeter,
                        metrics.Circularity,
                        metrics.Rectangularity,
                        metrics.AspectRatio,
                        metrics.RadialVariation,
                        metrics.EffectiveCornerCount,
                        holeVertices,
                        holeEdges,
                        supports.Select(value => value.OccurrenceId),
                        supports.Select(value => value.SourceHandle)));
                    if (child != null)
                    {
                        AddAdjacency(
                            adjacencyBuilders,
                            "contains_nested_boundary",
                            host.Id,
                            child.Id,
                            holeEdges,
                            SharedLength(holeEdges, edges),
                            "supported_by_dcel_hole_hierarchy");
                    }
                    holeIndex++;
                }
            }

            var profilesByEdge = new Dictionary<string, List<ProfileBuilder>>(StringComparer.Ordinal);
            foreach (ProfileBuilder profile in builders)
            {
                foreach (string edgeId in profile.BoundaryEdgeIds)
                {
                    List<ProfileBuilder> values;
                    if (!profilesByEdge.TryGetValue(edgeId, out values))
                    {
                        values = new List<ProfileBuilder>();
                        profilesByEdge[edgeId] = values;
                    }
                    values.Add(profile);
                }
            }
            foreach (KeyValuePair<string, List<ProfileBuilder>> entry in profilesByEdge)
            {
                List<ProfileBuilder> values = entry.Value.Distinct().OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
                for (int left = 0; left < values.Count; left++)
                {
                    for (int right = left + 1; right < values.Count; right++)
                    {
                        if (values[left].Region.Id != values[right].Region.Id) { continue; }
                        AddAdjacency(
                            adjacencyBuilders,
                            "shares_topological_boundary",
                            values[left].Id,
                            values[right].Id,
                            new[] { entry.Key },
                            edges.ContainsKey(entry.Key) ? edges[entry.Key].Length : 0,
                            "supported_by_shared_dcel_edge");
                    }
                }
            }
            List<ManufacturingProfileAdjacencyRecord> adjacencies = adjacencyBuilders.Values
                .OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            if (adjacencies.Count > config.MaximumAdjacencyCount)
            {
                adjacencies = adjacencies.Take(config.MaximumAdjacencyCount).ToList();
                diagnostics.Add(new ManufacturingProfileDiagnosticRecord(
                    "PROFILE_ADJACENCY_LIMIT_REACHED", "unsupported", "",
                    "Profile adjacency records were truncated at the configured limit."));
            }

            List<ManufacturingProfileRecord> profiles = builders.Select(value =>
                new ManufacturingProfileRecord(
                    value.Id,
                    value.Face.Id,
                    value.Region.Id,
                    value.ClusterId,
                    ProfileRole(value),
                    value.Metrics.ShapeClass,
                    value.Face.Status == "computed"
                        ? "candidate_from_computed_dcel"
                        : "ambiguous_non_simple_boundary",
                    value.BoundaryQuality,
                    value.Metrics.CenterX,
                    value.Metrics.CenterY,
                    value.Metrics.MinX,
                    value.Metrics.MinY,
                    value.Metrics.MaxX,
                    value.Metrics.MaxY,
                    value.Metrics.OrientedWidth,
                    value.Metrics.OrientedHeight,
                    value.Metrics.OrientationDegrees,
                    value.Face.GrossArea,
                    value.Face.NetArea,
                    value.Face.Perimeter,
                    value.Metrics.Circularity,
                    value.Metrics.Rectangularity,
                    value.Metrics.AspectRatio,
                    value.Metrics.RadialVariation,
                    value.Metrics.RightAngleRatio,
                    value.Metrics.EffectiveCornerCount,
                    value.Face.OuterVertexIds,
                    value.BoundaryEdgeIds,
                    value.OccurrenceIds,
                    value.Handles,
                    value.Roles,
                    value.ParentIds,
                    value.VoidIds)).OrderBy(value => value.Id, StringComparer.Ordinal).ToList();

            List<RepeatedManufacturingFeatureGroupRecord> repeatedGroups = BuildRepeatedGroups(
                voidBoundaries,
                viewRegions,
                topology,
                config);
            List<OpenManufacturingBoundaryRecord> openBoundaries = BuildOpenBoundaries(
                viewRegions,
                clusterByRegion,
                components,
                edges);
            List<ManufacturingObjectProfileSummaryRecord> objectSummaries = BuildObjectSummaries(
                identity,
                profiles,
                voidBoundaries,
                repeatedGroups,
                openBoundaries);

            int unassignedFaceCount = Math.Max(0, topology.Faces.Count - builders.Count);
            return new ManufacturingProfileFeatureDocument(
                regions.DrawingId,
                topology.Status,
                identity.Status,
                topology.Faces.Count,
                unassignedFaceCount,
                profiles,
                voidBoundaries.OrderBy(value => value.Id, StringComparer.Ordinal),
                adjacencies,
                repeatedGroups.OrderBy(value => value.Id, StringComparer.Ordinal),
                openBoundaries.OrderBy(value => value.Id, StringComparer.Ordinal),
                objectSummaries.OrderBy(value => value.PhysicalObjectClusterId, StringComparer.Ordinal),
                diagnostics);
        }

        static Dictionary<string, string> BuildClusterByRegion(
            RepresentationIdentityResolutionDocument identity,
            IList<ManufacturingProfileDiagnosticRecord> diagnostics)
        {
            var representations = identity.Representations.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (ResolvedPhysicalObjectClusterRecord cluster in identity.PhysicalObjectClusters)
            {
                foreach (string representationId in cluster.RepresentationIds)
                {
                    IdentityRepresentationRecord representation;
                    if (!representations.TryGetValue(representationId, out representation)
                        || string.IsNullOrEmpty(representation.RegionId)) { continue; }
                    string existing;
                    if (result.TryGetValue(representation.RegionId, out existing) && existing != cluster.Id)
                    {
                        diagnostics.Add(new ManufacturingProfileDiagnosticRecord(
                            "REGION_MAPPED_TO_MULTIPLE_OBJECT_CLUSTERS", "unsupported", representation.RegionId,
                            "A region is assigned to more than one physical object cluster; the first mapping was retained."));
                        continue;
                    }
                    result[representation.RegionId] = cluster.Id;
                }
            }
            return result;
        }

        static List<RepeatedManufacturingFeatureGroupRecord> BuildRepeatedGroups(
            IEnumerable<ManufacturingVoidBoundaryRecord> voids,
            IEnumerable<EngineeringViewRegionRecord> regions,
            PlanarTopologyDocument topology,
            ManufacturingProfileConfig config)
        {
            var regionById = regions.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var result = new List<RepeatedManufacturingFeatureGroupRecord>();
            foreach (IGrouping<string, ManufacturingVoidBoundaryRecord> group in voids
                .GroupBy(value => value.RegionId + "\u001f" + value.GeometrySignature, StringComparer.Ordinal)
                .Where(value => value.Count() >= config.MinimumRepeatedFeatureCount))
            {
                List<ManufacturingVoidBoundaryRecord> values = group.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
                EngineeringViewRegionRecord region;
                if (!regionById.TryGetValue(values[0].RegionId, out region)) { continue; }
                double tolerance = FeatureTolerance(region, topology, config);
                var local = values.Select(value => LocalPoint(region, value.CenterX, value.CenterY)).ToList();
                double xRange = local.Max(value => value[0]) - local.Min(value => value[0]);
                double yRange = local.Max(value => value[1]) - local.Min(value => value[1]);
                string alignment;
                List<double> spacings = new List<double>();
                if (yRange <= tolerance * 2)
                {
                    alignment = "local_x_row";
                    spacings = ConsecutiveSpacings(local.Select(value => value[0]), tolerance);
                }
                else if (xRange <= tolerance * 2)
                {
                    alignment = "local_y_column";
                    spacings = ConsecutiveSpacings(local.Select(value => value[1]), tolerance);
                }
                else
                {
                    List<double> obliqueSpacings;
                    if (values.Count == 2)
                    {
                        alignment = "pair_spacing_only";
                        spacings.Add(Distance(
                            local[0][0], local[0][1], local[1][0], local[1][1]));
                    }
                    else if (TryCollinearSpacings(local, tolerance, out obliqueSpacings))
                    {
                        alignment = "oblique_row_in_view_plane";
                        spacings = obliqueSpacings;
                    }
                    else
                    {
                        int xStations = QuantizedDistinct(local.Select(value => value[0]), tolerance);
                        int yStations = QuantizedDistinct(local.Select(value => value[1]), tolerance);
                        alignment = values.Count >= 4 && xStations > 1 && yStations > 1
                            ? "local_grid_candidate"
                            : "distributed_in_local_frame";
                    }
                }
                result.Add(new RepeatedManufacturingFeatureGroupRecord(
                    "repeated-manufacturing-feature-group:" + Hash(new[] { values[0].RegionId, values[0].GeometrySignature }),
                    values[0].RegionId,
                    values[0].PhysicalObjectClusterId,
                    values[0].ShapeClass,
                    values[0].GeometrySignature,
                    alignment,
                    values.Select(value => value.Id),
                    values.Select(value => new[] { value.CenterX, value.CenterY }),
                    spacings));
            }
            return result;
        }

        static List<OpenManufacturingBoundaryRecord> BuildOpenBoundaries(
            IEnumerable<EngineeringViewRegionRecord> regions,
            IDictionary<string, string> clusterByRegion,
            IDictionary<string, PlanarTopologyComponentRecord> components,
            IDictionary<string, PlanarEdgeRecord> edges)
        {
            var result = new List<OpenManufacturingBoundaryRecord>();
            foreach (EngineeringViewRegionRecord region in regions)
            {
                foreach (string componentId in region.ComponentIds)
                {
                    PlanarTopologyComponentRecord component;
                    if (!components.TryGetValue(componentId, out component) || component.EndpointCount <= 0) { continue; }
                    List<PlanarEdgeRecord> componentEdges = region.EdgeIds
                        .Where(edges.ContainsKey).Select(value => edges[value])
                        .Where(value => value.ComponentId == componentId)
                        .OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
                    List<PlanarEdgeSupportRecord> supports = componentEdges.SelectMany(value => value.Supports).ToList();
                    string clusterId;
                    clusterByRegion.TryGetValue(region.Id, out clusterId);
                    string kind = component.EndpointCount == 2 && component.BranchVertexCount == 0
                        ? "open_chain_candidate"
                        : component.BranchVertexCount > 0
                            ? "branched_open_network_candidate"
                            : "multi_endpoint_open_network_candidate";
                    result.Add(new OpenManufacturingBoundaryRecord(
                        "open-manufacturing-boundary:" + Hash(new[] { region.Id, componentId }),
                        componentId,
                        region.Id,
                        clusterId,
                        kind,
                        component.EndpointCount,
                        component.BranchVertexCount,
                        componentEdges.Select(value => value.Id),
                        supports.Select(value => value.OccurrenceId),
                        supports.Select(value => value.SourceHandle)));
                }
            }
            return result;
        }

        static List<ManufacturingObjectProfileSummaryRecord> BuildObjectSummaries(
            RepresentationIdentityResolutionDocument identity,
            IEnumerable<ManufacturingProfileRecord> profiles,
            IEnumerable<ManufacturingVoidBoundaryRecord> voids,
            IEnumerable<RepeatedManufacturingFeatureGroupRecord> repeats,
            IEnumerable<OpenManufacturingBoundaryRecord> opens)
        {
            var representationById = identity.Representations.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var result = new List<ManufacturingObjectProfileSummaryRecord>();
            foreach (ResolvedPhysicalObjectClusterRecord cluster in identity.PhysicalObjectClusters)
            {
                List<string> regionIds = cluster.RepresentationIds.Where(representationById.ContainsKey)
                    .Select(value => representationById[value].RegionId)
                    .Where(value => !string.IsNullOrEmpty(value)).Distinct(StringComparer.Ordinal).ToList();
                result.Add(new ManufacturingObjectProfileSummaryRecord(
                    cluster.Id,
                    cluster.RepresentationIds,
                    regionIds,
                    profiles.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id),
                    voids.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id),
                    repeats.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id),
                    opens.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id)));
            }
            return result;
        }

        static ShapeMetrics Measure(
            IEnumerable<string> vertexIds,
            IDictionary<string, PlanarVertexRecord> vertices,
            double? knownArea,
            double? knownPerimeter,
            ManufacturingProfileConfig config)
        {
            List<PlanarVertexRecord> points = vertexIds == null
                ? new List<PlanarVertexRecord>()
                : vertexIds.Where(vertices.ContainsKey).Select(value => vertices[value]).ToList();
            if (points.Count < 3) { return null; }
            double signedTwiceArea = 0;
            double centroidXNumerator = 0;
            double centroidYNumerator = 0;
            double perimeter = 0;
            double minX = points.Min(value => value.X);
            double minY = points.Min(value => value.Y);
            double maxX = points.Max(value => value.X);
            double maxY = points.Max(value => value.Y);
            for (int index = 0; index < points.Count; index++)
            {
                PlanarVertexRecord left = points[index];
                PlanarVertexRecord right = points[(index + 1) % points.Count];
                double cross = left.X * right.Y - right.X * left.Y;
                signedTwiceArea += cross;
                centroidXNumerator += (left.X + right.X) * cross;
                centroidYNumerator += (left.Y + right.Y) * cross;
                perimeter += Distance(left.X, left.Y, right.X, right.Y);
            }
            double polygonArea = Math.Abs(signedTwiceArea) * 0.5;
            double area = knownArea.HasValue ? Math.Abs(knownArea.Value) : polygonArea;
            if (area <= 0 || perimeter <= 0) { return null; }
            if (knownPerimeter.HasValue && knownPerimeter.Value > 0) { perimeter = knownPerimeter.Value; }
            double centerX;
            double centerY;
            if (Math.Abs(signedTwiceArea) > 0.000000000001)
            {
                centerX = centroidXNumerator / (3 * signedTwiceArea);
                centerY = centroidYNumerator / (3 * signedTwiceArea);
            }
            else
            {
                centerX = points.Average(value => value.X);
                centerY = points.Average(value => value.Y);
            }
            List<double> radii = points.Select(value => Distance(centerX, centerY, value.X, value.Y)).ToList();
            double meanRadius = radii.Average();
            double radialVariation = meanRadius <= 0
                ? 1
                : Math.Sqrt(radii.Sum(value => (value - meanRadius) * (value - meanRadius)) / radii.Count) / meanRadius;
            double width = Math.Max(0, maxX - minX);
            double height = Math.Max(0, maxY - minY);
            double[] oriented = OrientedExtents(points, centerX, centerY);
            double minimumExtent = Math.Min(oriented[0], oriented[1]);
            double maximumExtent = Math.Max(oriented[0], oriented[1]);
            double boundingArea = oriented[0] * oriented[1];
            double circularity = Math.Min(1, Math.Max(0, 4 * Math.PI * area / (perimeter * perimeter)));
            double rectangularity = boundingArea <= 0 ? 0 : Math.Min(1, area / boundingArea);
            double aspectRatio = minimumExtent <= 0 ? double.PositiveInfinity : maximumExtent / minimumExtent;
            int effectiveCorners = 0;
            int rightAngles = 0;
            for (int index = 0; index < points.Count; index++)
            {
                PlanarVertexRecord previous = points[(index + points.Count - 1) % points.Count];
                PlanarVertexRecord current = points[index];
                PlanarVertexRecord next = points[(index + 1) % points.Count];
                double ax = previous.X - current.X;
                double ay = previous.Y - current.Y;
                double bx = next.X - current.X;
                double by = next.Y - current.Y;
                double aLength = Math.Sqrt(ax * ax + ay * ay);
                double bLength = Math.Sqrt(bx * bx + by * by);
                if (aLength <= 0 || bLength <= 0) { continue; }
                double sine = Math.Abs(ax * by - ay * bx) / (aLength * bLength);
                if (sine < 0.0871557427476582) { continue; }
                effectiveCorners++;
                double cosine = Math.Abs(ax * bx + ay * by) / (aLength * bLength);
                if (cosine <= 0.0871557427476582) { rightAngles++; }
            }
            double rightAngleRatio = effectiveCorners == 0 ? 0 : (double)rightAngles / effectiveCorners;
            string shapeClass;
            if (circularity >= config.CircularityThreshold
                && radialVariation <= config.MaximumCircularRadialVariation
                && (effectiveCorners == 0 || effectiveCorners >= 8))
            {
                shapeClass = "circular_closed_profile";
            }
            else if (rectangularity >= config.RectangularityThreshold
                && rightAngleRatio >= config.MinimumRightAngleRatio
                && effectiveCorners >= 4 && effectiveCorners <= 8)
            {
                shapeClass = "rectangular_closed_profile";
            }
            else if (aspectRatio >= config.ElongatedAspectRatio)
            {
                shapeClass = "elongated_closed_profile";
            }
            else
            {
                shapeClass = "irregular_closed_profile";
            }
            return new ShapeMetrics
            {
                CenterX = centerX,
                CenterY = centerY,
                MinX = minX,
                MinY = minY,
                MaxX = maxX,
                MaxY = maxY,
                OrientedWidth = oriented[0],
                OrientedHeight = oriented[1],
                OrientationDegrees = oriented[2],
                Area = area,
                Perimeter = perimeter,
                Circularity = circularity,
                Rectangularity = rectangularity,
                AspectRatio = aspectRatio,
                RadialVariation = radialVariation,
                RightAngleRatio = rightAngleRatio,
                EffectiveCornerCount = effectiveCorners,
                ShapeClass = shapeClass
            };
        }

        static List<string> BoundaryEdges(
            IEnumerable<string> vertexIds,
            IDictionary<string, PlanarEdgeRecord> edgeByPair)
        {
            List<string> vertices = vertexIds.ToList();
            var result = new List<string>();
            for (int index = 0; index < vertices.Count; index++)
            {
                PlanarEdgeRecord edge;
                if (edgeByPair.TryGetValue(PairKey(vertices[index], vertices[(index + 1) % vertices.Count]), out edge))
                {
                    result.Add(edge.Id);
                }
            }
            return result.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToList();
        }

        static double[] OrientedExtents(
            IList<PlanarVertexRecord> points,
            double centerX,
            double centerY)
        {
            double covarianceX = 0;
            double covarianceY = 0;
            double covarianceXY = 0;
            double longestSquared = -1;
            double longestAngle = 0;
            for (int index = 0; index < points.Count; index++)
            {
                double dx = points[index].X - centerX;
                double dy = points[index].Y - centerY;
                covarianceX += dx * dx;
                covarianceY += dy * dy;
                covarianceXY += dx * dy;
                PlanarVertexRecord next = points[(index + 1) % points.Count];
                double edgeX = next.X - points[index].X;
                double edgeY = next.Y - points[index].Y;
                double squared = edgeX * edgeX + edgeY * edgeY;
                if (squared > longestSquared)
                {
                    longestSquared = squared;
                    longestAngle = Math.Atan2(edgeY, edgeX);
                }
            }
            double principalAngle = 0.5 * Math.Atan2(
                2 * covarianceXY,
                covarianceX - covarianceY);
            var angles = new[] { 0.0, principalAngle, longestAngle };
            double bestArea = double.PositiveInfinity;
            double bestWidth = 0;
            double bestHeight = 0;
            double bestAngle = 0;
            foreach (double angle in angles)
            {
                double cosine = Math.Cos(angle);
                double sine = Math.Sin(angle);
                double minU = double.PositiveInfinity;
                double maxU = double.NegativeInfinity;
                double minV = double.PositiveInfinity;
                double maxV = double.NegativeInfinity;
                foreach (PlanarVertexRecord point in points)
                {
                    double dx = point.X - centerX;
                    double dy = point.Y - centerY;
                    double u = dx * cosine + dy * sine;
                    double v = -dx * sine + dy * cosine;
                    minU = Math.Min(minU, u);
                    maxU = Math.Max(maxU, u);
                    minV = Math.Min(minV, v);
                    maxV = Math.Max(maxV, v);
                }
                double width = Math.Max(0, maxU - minU);
                double height = Math.Max(0, maxV - minV);
                double area = width * height;
                if (area < bestArea - 0.000000000001
                    || (Math.Abs(area - bestArea) <= 0.000000000001
                        && Math.Min(width, height) < Math.Min(bestWidth, bestHeight)))
                {
                    bestArea = area;
                    bestWidth = width;
                    bestHeight = height;
                    bestAngle = angle;
                }
            }
            double degrees = bestAngle * 180.0 / Math.PI;
            degrees %= 180;
            if (degrees < 0) { degrees += 180; }
            return new[] { bestWidth, bestHeight, degrees };
        }

        static void AddAdjacency(
            IDictionary<string, ManufacturingProfileAdjacencyRecord> values,
            string relationType,
            string left,
            string right,
            IEnumerable<string> edges,
            double sharedLength,
            string status)
        {
            string first = string.Compare(left, right, StringComparison.Ordinal) <= 0 ? left : right;
            string second = first == left ? right : left;
            List<string> edgeIds = ManufacturingProfileMaps.SortedUnique(edges);
            string key = relationType + "\u001f" + first + "\u001f" + second;
            ManufacturingProfileAdjacencyRecord existing;
            if (values.TryGetValue(key, out existing))
            {
                edgeIds = edgeIds.Concat(existing.SharedEdgeIds).Distinct(StringComparer.Ordinal).ToList();
                sharedLength += existing.SharedBoundaryLength;
            }
            values[key] = new ManufacturingProfileAdjacencyRecord(
                "manufacturing-profile-adjacency:" + Hash(new[] { relationType, first, second }),
                relationType,
                first,
                second,
                edgeIds,
                sharedLength,
                status);
        }

        static string ProfileRole(ProfileBuilder value)
        {
            bool nested = value.ParentIds.Count > 0;
            bool compound = value.VoidIds.Count > 0;
            if (nested && compound) { return "internal_compound_profile_candidate"; }
            if (nested) { return "internal_closed_feature_candidate"; }
            if (compound) { return "enclosing_compound_profile_candidate"; }
            return "bounded_profile_candidate";
        }

        static string BoundaryQuality(IEnumerable<PlanarEdgeSupportRecord> supports)
        {
            List<PlanarEdgeSupportRecord> values = supports.ToList();
            if (values.Count == 0) { return "boundary_edge_support_missing"; }
            bool approximated = values.Any(value =>
            {
                string quality = value.GeometryQuality ?? "";
                return quality.StartsWith("adaptive_", StringComparison.OrdinalIgnoreCase)
                    || quality.IndexOf("tessellation", StringComparison.OrdinalIgnoreCase) >= 0
                    || quality.IndexOf("approx", StringComparison.OrdinalIgnoreCase) >= 0;
            });
            return approximated
                ? "contains_approximated_curve_support"
                : "exact_or_linear_source_support";
        }

        static double SharedLength(IEnumerable<string> edgeIds, IDictionary<string, PlanarEdgeRecord> edges)
        {
            return edgeIds.Where(edges.ContainsKey).Sum(value => edges[value].Length);
        }

        static double FeatureTolerance(
            EngineeringViewRegionRecord region,
            PlanarTopologyDocument topology,
            ManufacturingProfileConfig config)
        {
            double scale = region.LocalFrame == null
                ? Math.Max(region.Width, region.Height)
                : region.LocalFrame.Scale;
            return Math.Max(topology.GridSize * 2, Math.Max(scale, topology.GridSize) * config.FeatureSizeToleranceRatio);
        }

        static string GeometrySignature(ShapeMetrics value, double tolerance)
        {
            double minimum = Math.Min(value.OrientedWidth, value.OrientedHeight);
            double maximum = Math.Max(value.OrientedWidth, value.OrientedHeight);
            return "manufacturing-feature-signature:" + Hash(new[]
            {
                value.ShapeClass,
                Quantize(minimum, tolerance).ToString(CultureInfo.InvariantCulture),
                Quantize(maximum, tolerance).ToString(CultureInfo.InvariantCulture),
                Quantize(value.Area, tolerance * tolerance).ToString(CultureInfo.InvariantCulture),
                Quantize(value.Perimeter, tolerance).ToString(CultureInfo.InvariantCulture),
                value.EffectiveCornerCount.ToString(CultureInfo.InvariantCulture)
            });
        }

        static long Quantize(double value, double tolerance)
        {
            return (long)Math.Round(value / Math.Max(tolerance, 0.000000000001), MidpointRounding.AwayFromZero);
        }

        static double[] LocalPoint(EngineeringViewRegionRecord region, double x, double y)
        {
            if (region.LocalFrame == null) { return new[] { x, y }; }
            double dx = x - region.LocalFrame.OriginX;
            double dy = y - region.LocalFrame.OriginY;
            return new[]
            {
                dx * region.LocalFrame.AxisXx + dy * region.LocalFrame.AxisXy,
                dx * region.LocalFrame.AxisYx + dy * region.LocalFrame.AxisYy
            };
        }

        static List<double> ConsecutiveSpacings(IEnumerable<double> values, double tolerance)
        {
            List<double> ordered = values.OrderBy(value => value).ToList();
            var result = new List<double>();
            for (int index = 1; index < ordered.Count; index++)
            {
                double spacing = ordered[index] - ordered[index - 1];
                if (spacing > tolerance * 0.5) { result.Add(spacing); }
            }
            return result;
        }

        static int QuantizedDistinct(IEnumerable<double> values, double tolerance)
        {
            return values.Select(value => Quantize(value, tolerance)).Distinct().Count();
        }

        static bool TryCollinearSpacings(
            IList<double[]> points,
            double tolerance,
            out List<double> spacings)
        {
            spacings = new List<double>();
            if (points == null || points.Count < 3) { return false; }
            double centerX = points.Average(value => value[0]);
            double centerY = points.Average(value => value[1]);
            double covarianceX = 0;
            double covarianceY = 0;
            double covarianceXY = 0;
            foreach (double[] point in points)
            {
                double dx = point[0] - centerX;
                double dy = point[1] - centerY;
                covarianceX += dx * dx;
                covarianceY += dy * dy;
                covarianceXY += dx * dy;
            }
            double angle = 0.5 * Math.Atan2(2 * covarianceXY, covarianceX - covarianceY);
            double cosine = Math.Cos(angle);
            double sine = Math.Sin(angle);
            var stations = new List<double>();
            double maximumResidual = 0;
            foreach (double[] point in points)
            {
                double dx = point[0] - centerX;
                double dy = point[1] - centerY;
                stations.Add(dx * cosine + dy * sine);
                maximumResidual = Math.Max(maximumResidual, Math.Abs(-dx * sine + dy * cosine));
            }
            if (maximumResidual > tolerance * 2) { return false; }
            spacings = ConsecutiveSpacings(stations, tolerance);
            return spacings.Count > 0;
        }

        static string VertexSetKey(IEnumerable<string> values)
        {
            return string.Join("|", values.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal));
        }

        static string PairKey(string left, string right)
        {
            return string.Compare(left, right, StringComparison.Ordinal) <= 0
                ? left + "\u001f" + right
                : right + "\u001f" + left;
        }

        static bool SameDrawing(string left, string right)
        {
            return string.Equals(left ?? "", right ?? "", StringComparison.Ordinal);
        }

        static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x2 - x1;
            double dy = y2 - y1;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static void ValidateConfig(ManufacturingProfileConfig config)
        {
            if (config.MinimumFaceAreaRatio < 0
                || config.CircularityThreshold <= 0 || config.CircularityThreshold > 1
                || config.MaximumCircularRadialVariation < 0
                || config.RectangularityThreshold <= 0 || config.RectangularityThreshold > 1
                || config.MinimumRightAngleRatio < 0 || config.MinimumRightAngleRatio > 1
                || config.ElongatedAspectRatio <= 1
                || config.FeatureSizeToleranceRatio <= 0
                || config.MinimumRepeatedFeatureCount < 2
                || config.MaximumFaceCandidateCount <= 0
                || config.MaximumAdjacencyCount <= 0)
            {
                throw new ArgumentOutOfRangeException("config", "Manufacturing profile configuration is outside its supported range.");
            }
        }

        static string Hash(IEnumerable<string> values)
        {
            string text = string.Join("\u001f", values ?? Enumerable.Empty<string>());
            using (SHA256 sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text)))
                    .Replace("-", "").Substring(0, 20).ToLowerInvariant();
            }
        }
    }

    static class ManufacturingProfileMaps
    {
        public static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[(string)values[index]] = values[index + 1];
            }
            return result;
        }

        public static List<string> SortedUnique(IEnumerable<string> values)
        {
            return values == null
                ? new List<string>()
                : values.Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal).ToList();
        }

        public static List<string> SortedUniquePreserveOrder(IEnumerable<string> values)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (values == null) { return result; }
            foreach (string value in values)
            {
                if (!string.IsNullOrWhiteSpace(value) && seen.Add(value)) { result.Add(value); }
            }
            return result;
        }
    }
}
