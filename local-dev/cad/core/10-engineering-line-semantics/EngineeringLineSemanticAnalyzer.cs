using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class EngineeringLinePointObservation
    {
        public EngineeringLinePointObservation(double x, double y, double bulge)
        {
            X = x;
            Y = y;
            Bulge = bulge;
        }

        public double X { get; private set; }
        public double Y { get; private set; }
        public double Bulge { get; private set; }
    }

    public sealed class EngineeringLineObservation
    {
        readonly List<EngineeringLinePointObservation> points;

        public EngineeringLineObservation(
            string handle,
            string runtimeClass,
            string managedType,
            string layer,
            string ownerScope,
            string ownerBlockName,
            string geometryKind,
            bool visible)
        {
            Handle = handle ?? "";
            RuntimeClass = runtimeClass ?? "";
            ManagedType = managedType ?? "";
            Layer = layer ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            GeometryKind = geometryKind ?? "";
            Visible = visible;
            EntityColorName = "";
            EntityColorMethod = "";
            EntityLinetype = "";
            points = new List<EngineeringLinePointObservation>();
        }

        public string Handle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string ManagedType { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string GeometryKind { get; private set; }
        public bool Visible { get; private set; }
        public bool HasEntityColorIndex { get; private set; }
        public int EntityColorIndex { get; private set; }
        public bool EntityColorIsByLayer { get; private set; }
        public bool EntityColorIsByBlock { get; private set; }
        public string EntityColorName { get; private set; }
        public string EntityColorMethod { get; private set; }
        public bool HasEntityRgb { get; private set; }
        public int EntityRed { get; private set; }
        public int EntityGreen { get; private set; }
        public int EntityBlue { get; private set; }
        public string EntityLinetype { get; private set; }
        public bool HasEntityLineweight { get; private set; }
        public int EntityLineweight { get; private set; }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public bool IsClosed { get; private set; }
        public IList<EngineeringLinePointObservation> Points
        {
            get { return points.AsReadOnly(); }
        }
        public bool HasCenter { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double Radius { get; private set; }
        public double StartAngle { get; private set; }
        public double EndAngle { get; private set; }
        public double MajorAxisX { get; private set; }
        public double MajorAxisY { get; private set; }
        public double RadiusRatio { get; private set; }

        public EngineeringLineObservation SetEntityColor(
            int? index,
            bool isByLayer,
            bool isByBlock,
            string name,
            string method,
            int? red,
            int? green,
            int? blue)
        {
            HasEntityColorIndex = index.HasValue;
            EntityColorIndex = index.HasValue ? index.Value : 0;
            EntityColorIsByLayer = isByLayer;
            EntityColorIsByBlock = isByBlock;
            EntityColorName = name ?? "";
            EntityColorMethod = method ?? "";
            if (red.HasValue && green.HasValue && blue.HasValue)
            {
                HasEntityRgb = true;
                EntityRed = red.Value;
                EntityGreen = green.Value;
                EntityBlue = blue.Value;
            }
            return this;
        }

        public EngineeringLineObservation SetEntityStyle(
            string linetype,
            int? lineweight)
        {
            EntityLinetype = linetype ?? "";
            HasEntityLineweight = lineweight.HasValue;
            EntityLineweight = lineweight.HasValue ? lineweight.Value : 0;
            return this;
        }

        public EngineeringLineObservation SetBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (Finite(minX) && Finite(minY) && Finite(maxX) && Finite(maxY))
            {
                HasBounds = true;
                MinX = Math.Min(minX, maxX);
                MinY = Math.Min(minY, maxY);
                MaxX = Math.Max(minX, maxX);
                MaxY = Math.Max(minY, maxY);
            }
            return this;
        }

        public EngineeringLineObservation SetLine(
            double startX,
            double startY,
            double endX,
            double endY)
        {
            points.Clear();
            AddPoint(startX, startY, 0);
            AddPoint(endX, endY, 0);
            IsClosed = false;
            return this;
        }

        public EngineeringLineObservation SetArc(
            double centerX,
            double centerY,
            double radius,
            double startAngle,
            double endAngle)
        {
            HasCenter = Finite(centerX) && Finite(centerY) && Finite(radius);
            CenterX = centerX;
            CenterY = centerY;
            Radius = radius;
            StartAngle = startAngle;
            EndAngle = endAngle;
            IsClosed = false;
            return this;
        }

        public EngineeringLineObservation SetCircle(
            double centerX,
            double centerY,
            double radius)
        {
            HasCenter = Finite(centerX) && Finite(centerY) && Finite(radius);
            CenterX = centerX;
            CenterY = centerY;
            Radius = radius;
            StartAngle = 0;
            EndAngle = Math.PI * 2.0;
            IsClosed = true;
            return this;
        }

        public EngineeringLineObservation SetEllipse(
            double centerX,
            double centerY,
            double majorAxisX,
            double majorAxisY,
            double radiusRatio,
            double startAngle,
            double endAngle)
        {
            HasCenter = Finite(centerX) && Finite(centerY);
            CenterX = centerX;
            CenterY = centerY;
            MajorAxisX = majorAxisX;
            MajorAxisY = majorAxisY;
            RadiusRatio = radiusRatio;
            StartAngle = startAngle;
            EndAngle = endAngle;
            double span = PositiveAngleSpan(startAngle, endAngle);
            IsClosed = Math.Abs(span - Math.PI * 2.0) <= 0.000001;
            return this;
        }

        public EngineeringLineObservation SetPath(
            bool closed,
            IList<EngineeringLinePointObservation> values)
        {
            points.Clear();
            if (values != null)
            {
                foreach (EngineeringLinePointObservation value in values)
                {
                    if (value != null)
                    {
                        points.Add(value);
                    }
                }
            }
            IsClosed = closed;
            return this;
        }

        public bool IsCurveLike
        {
            get
            {
                string kind = GeometryKind ?? "";
                return string.Equals(kind, "line", StringComparison.Ordinal)
                    || string.Equals(kind, "arc", StringComparison.Ordinal)
                    || string.Equals(kind, "circle", StringComparison.Ordinal)
                    || string.Equals(kind, "ellipse", StringComparison.Ordinal)
                    || string.Equals(kind, "lwpolyline", StringComparison.Ordinal)
                    || string.Equals(kind, "polyline2d", StringComparison.Ordinal)
                    || string.Equals(kind, "polyline3d", StringComparison.Ordinal)
                    || string.Equals(kind, "spline", StringComparison.Ordinal);
            }
        }

        void AddPoint(double x, double y, double bulge)
        {
            if (Finite(x) && Finite(y))
            {
                points.Add(new EngineeringLinePointObservation(x, y, bulge));
            }
        }

        static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        static double PositiveAngleSpan(double start, double end)
        {
            double span = end - start;
            while (span < 0) { span += Math.PI * 2.0; }
            while (span > Math.PI * 2.0) { span -= Math.PI * 2.0; }
            return span;
        }
    }

    public sealed class EngineeringLayerStyleObservation
    {
        public EngineeringLayerStyleObservation(
            string name,
            string colorName,
            int? colorIndex,
            bool colorIsByLayer,
            bool colorIsByBlock,
            string colorMethod,
            int? red,
            int? green,
            int? blue,
            string linetype,
            int? lineweight)
        {
            Name = name ?? "";
            ColorName = colorName ?? "";
            HasColorIndex = colorIndex.HasValue;
            ColorIndex = colorIndex.HasValue ? colorIndex.Value : 0;
            ColorIsByLayer = colorIsByLayer;
            ColorIsByBlock = colorIsByBlock;
            ColorMethod = colorMethod ?? "";
            HasRgb = red.HasValue && green.HasValue && blue.HasValue;
            Red = red.HasValue ? red.Value : 0;
            Green = green.HasValue ? green.Value : 0;
            Blue = blue.HasValue ? blue.Value : 0;
            Linetype = linetype ?? "";
            HasLineweight = lineweight.HasValue;
            Lineweight = lineweight.HasValue ? lineweight.Value : 0;
        }

        public string Name { get; private set; }
        public string ColorName { get; private set; }
        public bool HasColorIndex { get; private set; }
        public int ColorIndex { get; private set; }
        public bool ColorIsByLayer { get; private set; }
        public bool ColorIsByBlock { get; private set; }
        public string ColorMethod { get; private set; }
        public bool HasRgb { get; private set; }
        public int Red { get; private set; }
        public int Green { get; private set; }
        public int Blue { get; private set; }
        public string Linetype { get; private set; }
        public bool HasLineweight { get; private set; }
        public int Lineweight { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "name", Name,
                "color", EngineeringLineMaps.Map(
                    "name", ColorName,
                    "index", HasColorIndex ? (object)ColorIndex : null,
                    "rgb", HasRgb ? (object)new[] { Red, Green, Blue } : null,
                    "is_by_layer", ColorIsByLayer,
                    "is_by_block", ColorIsByBlock,
                    "method", ColorMethod),
                "linetype", Linetype,
                "lineweight", HasLineweight ? (object)Lineweight : null,
                "semantic_boundary", "layer_style_definition_not_business_meaning");
        }
    }

    public sealed class EngineeringLinetypeDefinitionObservation
    {
        readonly List<double> dashLengths;

        public EngineeringLinetypeDefinitionObservation(
            string name,
            string asciiDescription,
            string comments,
            double? patternLength,
            IList<double> dashes)
        {
            Name = name ?? "";
            AsciiDescription = asciiDescription ?? "";
            Comments = comments ?? "";
            HasPatternLength = patternLength.HasValue;
            PatternLength = patternLength.HasValue ? patternLength.Value : 0;
            dashLengths = dashes == null
                ? new List<double>()
                : new List<double>(dashes);
        }

        public string Name { get; private set; }
        public string AsciiDescription { get; private set; }
        public string Comments { get; private set; }
        public bool HasPatternLength { get; private set; }
        public double PatternLength { get; private set; }
        public IList<double> DashLengths { get { return dashLengths.AsReadOnly(); } }
    }

    public sealed class EngineeringReferenceAxisObservation
    {
        readonly List<EngineeringAxisShiftObservation> candidateShifts;

        public EngineeringReferenceAxisObservation(
            string handle,
            string name,
            string ownerScope,
            string ownerBlockName,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            Handle = handle ?? "";
            Name = name ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            StartX = startX;
            StartY = startY;
            EndX = endX;
            EndY = endY;
            candidateShifts = new List<EngineeringAxisShiftObservation>();
            AddCandidateShift(0, 0, "named_reference_axis");
        }

        public string Handle { get; private set; }
        public string Name { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
        public IList<EngineeringAxisShiftObservation> CandidateShifts
        {
            get { return candidateShifts.AsReadOnly(); }
        }

        public EngineeringReferenceAxisObservation AddCandidateShift(
            double shiftX,
            double shiftY,
            string source)
        {
            foreach (EngineeringAxisShiftObservation existing in candidateShifts)
            {
                if (Distance(existing.ShiftX, existing.ShiftY, shiftX, shiftY) <= 0.000001)
                {
                    existing.AddSource(source);
                    return this;
                }
            }
            candidateShifts.Add(new EngineeringAxisShiftObservation(
                shiftX,
                shiftY,
                source));
            return this;
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx;
            double dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }
    }

    public sealed class EngineeringAxisShiftObservation
    {
        readonly List<string> sources;

        internal EngineeringAxisShiftObservation(double shiftX, double shiftY, string source)
        {
            ShiftX = shiftX;
            ShiftY = shiftY;
            sources = new List<string>();
            AddSource(source);
        }

        public double ShiftX { get; private set; }
        public double ShiftY { get; private set; }
        public IList<string> Sources { get { return sources.AsReadOnly(); } }

        internal void AddSource(string source)
        {
            if (!string.IsNullOrEmpty(source) && !sources.Contains(source))
            {
                sources.Add(source);
            }
        }
    }

    public sealed class EngineeringLineSemanticConfig
    {
        public EngineeringLineSemanticConfig()
        {
            GeometryTolerance = 0.05;
            SymmetryMatchTolerance = 0.25;
            SymmetryCoverageThreshold = 0.85;
            SymmetryMinimumFeatureCount = 4;
            SymmetryContextNormalSpanFactor = 2.0;
            SymmetryContextTangentMarginFactor = 0.25;
            RepetitionSizeTolerance = 0.10;
            SampleHandleLimit = 12;
            SymmetryPairSampleLimit = 24;
            MaxDerivedSymmetryShiftCandidates = 64;
        }

        public double GeometryTolerance { get; set; }
        public double SymmetryMatchTolerance { get; set; }
        public double SymmetryCoverageThreshold { get; set; }
        public int SymmetryMinimumFeatureCount { get; set; }
        public double SymmetryContextNormalSpanFactor { get; set; }
        public double SymmetryContextTangentMarginFactor { get; set; }
        public double RepetitionSizeTolerance { get; set; }
        public int SampleHandleLimit { get; set; }
        public int SymmetryPairSampleLimit { get; set; }
        public int MaxDerivedSymmetryShiftCandidates { get; set; }
    }

    public sealed class EngineeringLinetypeCatalogRecord
    {
        readonly List<double> dashLengths;
        readonly List<string> evidence;

        internal EngineeringLinetypeCatalogRecord(
            string name,
            bool defined,
            string asciiDescription,
            string comments,
            double? patternLength,
            IList<double> dashes,
            string family,
            IList<string> familyEvidence)
        {
            Name = name ?? "";
            IsDefined = defined;
            AsciiDescription = asciiDescription ?? "";
            Comments = comments ?? "";
            HasPatternLength = patternLength.HasValue;
            PatternLength = patternLength.HasValue ? patternLength.Value : 0;
            dashLengths = dashes == null
                ? new List<double>()
                : new List<double>(dashes);
            Family = family ?? "other";
            evidence = familyEvidence == null
                ? new List<string>()
                : new List<string>(familyEvidence);
        }

        public string Name { get; private set; }
        public bool IsDefined { get; private set; }
        public string AsciiDescription { get; private set; }
        public string Comments { get; private set; }
        public bool HasPatternLength { get; private set; }
        public double PatternLength { get; private set; }
        public IList<double> DashLengths { get { return dashLengths.AsReadOnly(); } }
        public string Family { get; private set; }
        public int EntityUsageCount { get; internal set; }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "name", Name,
                "defined_in_drawing", IsDefined,
                "ascii_description", AsciiDescription,
                "comments", Comments,
                "pattern_length", HasPatternLength ? (object)PatternLength : null,
                "dash_lengths", new List<double>(dashLengths),
                "line_family", Family,
                "entity_usage_count", EntityUsageCount,
                "classification_status", Family == "other"
                    ? "retained_for_future_analysis"
                    : "recognized_line_family",
                "evidence", new List<string>(evidence));
        }
    }

    public sealed class EngineeringStyleProfileRecord
    {
        readonly Dictionary<string, int> entityTypeCounts;
        readonly List<string> sampleHandles;
        readonly List<string> roleCandidates;
        readonly List<string> evidence;

        internal EngineeringStyleProfileRecord(
            string key,
            ResolvedEngineeringStyle style,
            EngineeringRoleAnalysis role)
        {
            Key = key;
            Layer = style.Layer;
            EffectiveColorName = style.ColorName;
            HasEffectiveColorIndex = style.HasColorIndex;
            EffectiveColorIndex = style.ColorIndex;
            HasEffectiveRgb = style.HasRgb;
            EffectiveRed = style.Red;
            EffectiveGreen = style.Green;
            EffectiveBlue = style.Blue;
            ColorSource = style.ColorSource;
            ColorResolutionStatus = style.ColorResolutionStatus;
            EffectiveLinetype = style.Linetype;
            LinetypeFamily = style.LinetypeFamily;
            LinetypeSource = style.LinetypeSource;
            LinetypeResolutionStatus = style.LinetypeResolutionStatus;
            HasEffectiveLineweight = style.HasLineweight;
            EffectiveLineweight = style.Lineweight;
            LineweightSource = style.LineweightSource;
            LineweightResolutionStatus = style.LineweightResolutionStatus;
            PrimaryRole = role.PrimaryRole;
            RoleResolutionStatus = role.Status;
            roleCandidates = new List<string>(role.Candidates);
            evidence = new List<string>(role.Evidence);
            entityTypeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            sampleHandles = new List<string>();
        }

        internal string Key { get; private set; }
        public string Id { get; internal set; }
        public string Layer { get; private set; }
        public string EffectiveColorName { get; private set; }
        public bool HasEffectiveColorIndex { get; private set; }
        public int EffectiveColorIndex { get; private set; }
        public bool HasEffectiveRgb { get; private set; }
        public int EffectiveRed { get; private set; }
        public int EffectiveGreen { get; private set; }
        public int EffectiveBlue { get; private set; }
        public string ColorSource { get; private set; }
        public string ColorResolutionStatus { get; private set; }
        public string EffectiveLinetype { get; private set; }
        public string LinetypeFamily { get; private set; }
        public string LinetypeSource { get; private set; }
        public string LinetypeResolutionStatus { get; private set; }
        public bool HasEffectiveLineweight { get; private set; }
        public int EffectiveLineweight { get; private set; }
        public string LineweightSource { get; private set; }
        public string LineweightResolutionStatus { get; private set; }
        public string PrimaryRole { get; private set; }
        public string RoleResolutionStatus { get; private set; }
        public int EntityCount { get; private set; }
        public int CurveEntityCount { get; private set; }
        public IDictionary<string, int> EntityTypeCounts
        {
            get { return new Dictionary<string, int>(entityTypeCounts, StringComparer.Ordinal); }
        }
        public IList<string> SampleHandles { get { return sampleHandles.AsReadOnly(); } }
        public IList<string> RoleCandidates { get { return roleCandidates.AsReadOnly(); } }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }
        public bool RequiresFutureAnalysis
        {
            get
            {
                return PrimaryRole == "unclassified"
                    || RoleResolutionStatus != "resolved"
                    || ColorResolutionStatus != "resolved"
                    || LinetypeResolutionStatus != "resolved";
            }
        }

        internal void Add(EngineeringLineObservation observation, int sampleLimit)
        {
            EntityCount++;
            if (observation.IsCurveLike) { CurveEntityCount++; }
            string type = string.IsNullOrEmpty(observation.ManagedType)
                ? observation.RuntimeClass
                : observation.ManagedType;
            int count;
            entityTypeCounts.TryGetValue(type ?? "", out count);
            entityTypeCounts[type ?? ""] = count + 1;
            if (sampleHandles.Count < sampleLimit
                && !string.IsNullOrEmpty(observation.Handle))
            {
                sampleHandles.Add(observation.Handle);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "id", Id,
                "layer", Layer,
                "effective_color", EngineeringLineMaps.Map(
                    "name", EffectiveColorName,
                    "index", HasEffectiveColorIndex ? (object)EffectiveColorIndex : null,
                    "rgb", HasEffectiveRgb
                        ? (object)new[] { EffectiveRed, EffectiveGreen, EffectiveBlue }
                        : null,
                    "source", ColorSource,
                    "resolution_status", ColorResolutionStatus),
                "effective_linetype", EffectiveLinetype,
                "linetype_family", LinetypeFamily,
                "linetype_source", LinetypeSource,
                "linetype_resolution_status", LinetypeResolutionStatus,
                "effective_lineweight", HasEffectiveLineweight
                    ? (object)EffectiveLineweight
                    : null,
                "lineweight_source", LineweightSource,
                "lineweight_resolution_status", LineweightResolutionStatus,
                "primary_role", PrimaryRole,
                "role_candidates", new List<string>(roleCandidates),
                "role_resolution_status", RoleResolutionStatus,
                "requires_future_analysis", RequiresFutureAnalysis,
                "entity_count", EntityCount,
                "curve_entity_count", CurveEntityCount,
                "entity_type_counts", new Dictionary<string, int>(
                    entityTypeCounts,
                    StringComparer.Ordinal),
                "sample_handles", new List<string>(sampleHandles),
                "evidence", new List<string>(evidence));
        }
    }

    public sealed class EngineeringColorUsageRecord
    {
        readonly Dictionary<string, int> layerCounts;
        readonly Dictionary<string, int> roleCounts;
        readonly List<string> sampleHandles;

        internal EngineeringColorUsageRecord(ResolvedEngineeringStyle style)
        {
            Name = style.ColorName;
            HasIndex = style.HasColorIndex;
            Index = style.ColorIndex;
            HasRgb = style.HasRgb;
            Red = style.Red;
            Green = style.Green;
            Blue = style.Blue;
            ResolutionStatus = style.ColorResolutionStatus;
            layerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            roleCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            sampleHandles = new List<string>();
        }

        public string Name { get; private set; }
        public bool HasIndex { get; private set; }
        public int Index { get; private set; }
        public bool HasRgb { get; private set; }
        public int Red { get; private set; }
        public int Green { get; private set; }
        public int Blue { get; private set; }
        public string ResolutionStatus { get; private set; }
        public int EntityCount { get; private set; }
        public IDictionary<string, int> LayerCounts
        {
            get { return new Dictionary<string, int>(layerCounts, StringComparer.Ordinal); }
        }
        public IDictionary<string, int> RoleCounts
        {
            get { return new Dictionary<string, int>(roleCounts, StringComparer.Ordinal); }
        }

        internal void Add(
            EngineeringLineObservation observation,
            string role,
            int sampleLimit)
        {
            EntityCount++;
            Increment(layerCounts, observation.Layer);
            Increment(roleCounts, role);
            if (sampleHandles.Count < sampleLimit
                && !string.IsNullOrEmpty(observation.Handle))
            {
                sampleHandles.Add(observation.Handle);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "name", Name,
                "index", HasIndex ? (object)Index : null,
                "rgb", HasRgb ? (object)new[] { Red, Green, Blue } : null,
                "resolution_status", ResolutionStatus,
                "entity_count", EntityCount,
                "layer_counts", new Dictionary<string, int>(layerCounts, StringComparer.Ordinal),
                "role_counts", new Dictionary<string, int>(roleCounts, StringComparer.Ordinal),
                "sample_handles", new List<string>(sampleHandles),
                "semantic_boundary", "color_is_evidence_not_business_meaning");
        }

        static void Increment(IDictionary<string, int> values, string key)
        {
            key = key ?? "";
            int count;
            values.TryGetValue(key, out count);
            values[key] = count + 1;
        }
    }

    public sealed class EngineeringStrokeRecord
    {
        readonly List<string> roleCandidates;

        internal EngineeringStrokeRecord(
            EngineeringLineObservation source,
            EngineeringStyleProfileRecord profile,
            EngineeringRoleAnalysis role)
        {
            Source = source;
            Handle = source.Handle;
            RuntimeClass = source.RuntimeClass;
            ManagedType = source.ManagedType;
            Layer = source.Layer;
            OwnerScope = source.OwnerScope;
            OwnerBlockName = source.OwnerBlockName;
            GeometryKind = source.GeometryKind;
            StyleProfileId = profile.Id;
            PrimaryRole = role.PrimaryRole;
            RoleResolutionStatus = role.Status;
            roleCandidates = new List<string>(role.Candidates);
            Visible = source.Visible;
            GeometryQuality = "exact_database_geometry";
            InitializeGeometry(source);
        }

        internal EngineeringLineObservation Source { get; private set; }
        public string Handle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string ManagedType { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string GeometryKind { get; private set; }
        public string StyleProfileId { get; private set; }
        public string PrimaryRole { get; private set; }
        public string RoleResolutionStatus { get; private set; }
        public IList<string> RoleCandidates { get { return roleCandidates.AsReadOnly(); } }
        public bool Visible { get; private set; }
        public bool HasEndpoints { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
        public bool IsClosed { get; private set; }
        public bool HasCenter { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double Radius { get; private set; }
        public double Length { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public string GeometryQuality { get; private set; }
        public string TopologyComponentId { get; internal set; }

        public bool TopologyEligible
        {
            get
            {
                return Visible
                    && PrimaryRole != "annotation_geometry"
                    && (HasEndpoints || IsClosed);
            }
        }

        public string GeometryFamily
        {
            get
            {
                if (GeometryKind == "line") { return "line"; }
                if (GeometryKind == "circle") { return "circle"; }
                if (GeometryKind == "arc") { return "arc"; }
                if (GeometryKind == "ellipse") { return "ellipse"; }
                return "path";
            }
        }

        public double MidX { get { return (MinX + MaxX) * 0.5; } }
        public double MidY { get { return (MinY + MaxY) * 0.5; } }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "handle", Handle,
                "runtime_class", RuntimeClass,
                "managed_type", ManagedType,
                "layer", Layer,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "geometry_kind", GeometryKind,
                "geometry_family", GeometryFamily,
                "geometry_quality", GeometryQuality,
                "style_profile_id", StyleProfileId,
                "primary_role", PrimaryRole,
                "role_candidates", new List<string>(roleCandidates),
                "role_resolution_status", RoleResolutionStatus,
                "topology_component_id", TopologyComponentId,
                "closed", IsClosed,
                "start", HasEndpoints ? (object)new[] { StartX, StartY } : null,
                "end", HasEndpoints ? (object)new[] { EndX, EndY } : null,
                "center", HasCenter ? (object)new[] { CenterX, CenterY } : null,
                "radius", HasCenter && Radius > 0 ? (object)Radius : null,
                "length", Length,
                "bounds", new[] { MinX, MinY, MaxX, MaxY });
        }

        void InitializeGeometry(EngineeringLineObservation source)
        {
            IsClosed = source.IsClosed;
            HasCenter = source.HasCenter;
            CenterX = source.CenterX;
            CenterY = source.CenterY;
            Radius = source.Radius;
            if (source.GeometryKind == "line" && source.Points.Count >= 2)
            {
                SetEndpoints(source.Points[0], source.Points[1]);
                Length = Distance(StartX, StartY, EndX, EndY);
            }
            else if (source.GeometryKind == "arc" && source.HasCenter)
            {
                StartX = source.CenterX + Math.Cos(source.StartAngle) * source.Radius;
                StartY = source.CenterY + Math.Sin(source.StartAngle) * source.Radius;
                EndX = source.CenterX + Math.Cos(source.EndAngle) * source.Radius;
                EndY = source.CenterY + Math.Sin(source.EndAngle) * source.Radius;
                HasEndpoints = true;
                Length = Math.Abs(PositiveAngleSpan(source.StartAngle, source.EndAngle))
                    * Math.Abs(source.Radius);
            }
            else if (source.GeometryKind == "circle" && source.HasCenter)
            {
                Length = Math.PI * 2.0 * Math.Abs(source.Radius);
            }
            else if (source.GeometryKind == "ellipse" && source.HasCenter)
            {
                double major = Math.Sqrt(
                    source.MajorAxisX * source.MajorAxisX
                    + source.MajorAxisY * source.MajorAxisY);
                double minor = major * Math.Abs(source.RadiusRatio);
                SetEllipseEndpoint(source, source.StartAngle, true);
                SetEllipseEndpoint(source, source.EndAngle, false);
                Length = Math.PI * (3.0 * (major + minor)
                    - Math.Sqrt((3.0 * major + minor) * (major + 3.0 * minor)));
                if (!source.IsClosed)
                {
                    Length *= PositiveAngleSpan(source.StartAngle, source.EndAngle)
                        / (Math.PI * 2.0);
                }
            }
            else if (source.Points.Count >= 2)
            {
                SetEndpoints(source.Points[0], source.Points[source.Points.Count - 1]);
                Length = PathLength(source.Points, source.IsClosed);
                if (source.GeometryKind == "spline")
                {
                    GeometryQuality = "control_polygon_approximation";
                }
                else if (HasBulges(source.Points))
                {
                    GeometryQuality = "polyline_chord_approximation_for_bulged_segments";
                }
            }

            if (source.HasBounds)
            {
                MinX = source.MinX;
                MinY = source.MinY;
                MaxX = source.MaxX;
                MaxY = source.MaxY;
            }
            else
            {
                ComputeBounds(source);
            }
        }

        void SetEndpoints(
            EngineeringLinePointObservation first,
            EngineeringLinePointObservation last)
        {
            StartX = first.X;
            StartY = first.Y;
            EndX = last.X;
            EndY = last.Y;
            HasEndpoints = true;
        }

        void SetEllipseEndpoint(
            EngineeringLineObservation source,
            double angle,
            bool first)
        {
            double majorLength = Math.Sqrt(
                source.MajorAxisX * source.MajorAxisX
                + source.MajorAxisY * source.MajorAxisY);
            if (majorLength <= 0)
            {
                return;
            }
            double minorX = -source.MajorAxisY * source.RadiusRatio;
            double minorY = source.MajorAxisX * source.RadiusRatio;
            double x = source.CenterX
                + source.MajorAxisX * Math.Cos(angle)
                + minorX * Math.Sin(angle);
            double y = source.CenterY
                + source.MajorAxisY * Math.Cos(angle)
                + minorY * Math.Sin(angle);
            if (first)
            {
                StartX = x;
                StartY = y;
            }
            else
            {
                EndX = x;
                EndY = y;
            }
            HasEndpoints = !source.IsClosed;
        }

        void ComputeBounds(EngineeringLineObservation source)
        {
            MinX = double.PositiveInfinity;
            MinY = double.PositiveInfinity;
            MaxX = double.NegativeInfinity;
            MaxY = double.NegativeInfinity;
            foreach (EngineeringLinePointObservation point in source.Points)
            {
                Include(point.X, point.Y);
            }
            if (source.HasCenter)
            {
                double r = Math.Abs(source.Radius);
                if (source.GeometryKind == "ellipse")
                {
                    double major = Math.Sqrt(
                        source.MajorAxisX * source.MajorAxisX
                        + source.MajorAxisY * source.MajorAxisY);
                    r = Math.Max(major, major * Math.Abs(source.RadiusRatio));
                }
                Include(source.CenterX - r, source.CenterY - r);
                Include(source.CenterX + r, source.CenterY + r);
            }
            if (double.IsPositiveInfinity(MinX))
            {
                MinX = MinY = MaxX = MaxY = 0;
            }
        }

        void Include(double x, double y)
        {
            MinX = Math.Min(MinX, x);
            MinY = Math.Min(MinY, y);
            MaxX = Math.Max(MaxX, x);
            MaxY = Math.Max(MaxY, y);
        }

        static bool HasBulges(IList<EngineeringLinePointObservation> values)
        {
            foreach (EngineeringLinePointObservation value in values)
            {
                if (Math.Abs(value.Bulge) > 0.0000001) { return true; }
            }
            return false;
        }

        static double PathLength(
            IList<EngineeringLinePointObservation> values,
            bool closed)
        {
            double result = 0;
            for (int index = 1; index < values.Count; index++)
            {
                result += Distance(
                    values[index - 1].X,
                    values[index - 1].Y,
                    values[index].X,
                    values[index].Y);
            }
            if (closed && values.Count > 2)
            {
                result += Distance(
                    values[values.Count - 1].X,
                    values[values.Count - 1].Y,
                    values[0].X,
                    values[0].Y);
            }
            return result;
        }

        static double PositiveAngleSpan(double start, double end)
        {
            double span = end - start;
            while (span < 0) { span += Math.PI * 2.0; }
            while (span > Math.PI * 2.0) { span -= Math.PI * 2.0; }
            return span;
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx;
            double dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }
    }

    public sealed class EngineeringTopologyNodeRecord
    {
        readonly List<string> incidentHandles;

        internal EngineeringTopologyNodeRecord(
            string id,
            string ownerScope,
            string ownerBlockName,
            string role,
            double x,
            double y)
        {
            Id = id;
            OwnerScope = ownerScope;
            OwnerBlockName = ownerBlockName;
            Role = role;
            X = x;
            Y = y;
            incidentHandles = new List<string>();
        }

        public string Id { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string Role { get; private set; }
        public double X { get; internal set; }
        public double Y { get; internal set; }
        public IList<string> IncidentHandles { get { return incidentHandles.AsReadOnly(); } }
        public int Degree { get { return incidentHandles.Count; } }

        internal void Add(string handle)
        {
            if (!incidentHandles.Contains(handle)) { incidentHandles.Add(handle); }
        }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "id", Id,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "role", Role,
                "point", new[] { X, Y },
                "degree", Degree,
                "incident_handles", new List<string>(incidentHandles));
        }
    }

    public sealed class EngineeringTopologyComponentRecord
    {
        readonly List<string> strokeHandles;
        readonly List<string> nodeIds;

        internal EngineeringTopologyComponentRecord(
            string id,
            string ownerScope,
            string ownerBlockName,
            string role)
        {
            Id = id;
            OwnerScope = ownerScope;
            OwnerBlockName = ownerBlockName;
            Role = role;
            strokeHandles = new List<string>();
            nodeIds = new List<string>();
            MinX = double.PositiveInfinity;
            MinY = double.PositiveInfinity;
            MaxX = double.NegativeInfinity;
            MaxY = double.NegativeInfinity;
        }

        public string Id { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string Role { get; private set; }
        public IList<string> StrokeHandles { get { return strokeHandles.AsReadOnly(); } }
        public IList<string> NodeIds { get { return nodeIds.AsReadOnly(); } }
        public int StrokeCount { get { return strokeHandles.Count; } }
        public int OpenEndCount { get; internal set; }
        public int BranchNodeCount { get; internal set; }
        public bool IsClosed { get; internal set; }
        public double TotalLength { get; internal set; }
        public double MinX { get; internal set; }
        public double MinY { get; internal set; }
        public double MaxX { get; internal set; }
        public double MaxY { get; internal set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public double CenterX { get { return (MinX + MaxX) * 0.5; } }
        public double CenterY { get { return (MinY + MaxY) * 0.5; } }

        internal void AddStroke(EngineeringStrokeRecord stroke)
        {
            if (!strokeHandles.Contains(stroke.Handle))
            {
                strokeHandles.Add(stroke.Handle);
                TotalLength += stroke.Length;
                MinX = Math.Min(MinX, stroke.MinX);
                MinY = Math.Min(MinY, stroke.MinY);
                MaxX = Math.Max(MaxX, stroke.MaxX);
                MaxY = Math.Max(MaxY, stroke.MaxY);
            }
        }

        internal void AddNode(string id)
        {
            if (!nodeIds.Contains(id)) { nodeIds.Add(id); }
        }

        internal bool ContainsBounds(
            EngineeringTopologyComponentRecord child,
            double tolerance)
        {
            return child.MinX >= MinX - tolerance
                && child.MinY >= MinY - tolerance
                && child.MaxX <= MaxX + tolerance
                && child.MaxY <= MaxY + tolerance;
        }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "id", Id,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "role", Role,
                "stroke_count", StrokeCount,
                "stroke_handles", new List<string>(strokeHandles),
                "node_ids", new List<string>(nodeIds),
                "closed", IsClosed,
                "open_end_count", OpenEndCount,
                "branch_node_count", BranchNodeCount,
                "total_length", TotalLength,
                "bounds", new[] { MinX, MinY, MaxX, MaxY },
                "center", new[] { CenterX, CenterY },
                "width", Width,
                "height", Height,
                "semantic_status", IsClosed
                    ? "closed_contour_candidate"
                    : "connected_stroke_network");
        }
    }

    public sealed class EngineeringLineRelationRecord
    {
        readonly List<string> evidence;

        internal EngineeringLineRelationRecord(
            string id,
            string type,
            string fromId,
            string toId)
        {
            Id = id;
            RelationType = type;
            FromId = fromId;
            ToId = toId;
            evidence = new List<string>();
        }

        public string Id { get; private set; }
        public string RelationType { get; private set; }
        public string FromId { get; private set; }
        public string ToId { get; private set; }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }

        internal void AddEvidence(string value)
        {
            if (!string.IsNullOrEmpty(value) && !evidence.Contains(value))
            {
                evidence.Add(value);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "id", Id,
                "relation_type", RelationType,
                "from_id", FromId,
                "to_id", ToId,
                "evidence", new List<string>(evidence),
                "semantic_status", "derived_geometric_relation");
        }
    }

    public sealed class EngineeringRepeatedPatternRecord
    {
        readonly List<string> componentIds;
        readonly List<double[]> translationVectors;

        internal EngineeringRepeatedPatternRecord(
            string id,
            string ownerScope,
            string ownerBlockName,
            string role,
            string signature,
            IList<EngineeringTopologyComponentRecord> components)
        {
            Id = id;
            OwnerScope = ownerScope;
            OwnerBlockName = ownerBlockName;
            Role = role;
            Signature = signature;
            componentIds = new List<string>();
            translationVectors = new List<double[]>();
            if (components != null && components.Count > 0)
            {
                EngineeringTopologyComponentRecord first = components[0];
                foreach (EngineeringTopologyComponentRecord component in components)
                {
                    componentIds.Add(component.Id);
                    translationVectors.Add(new[]
                    {
                        component.CenterX - first.CenterX,
                        component.CenterY - first.CenterY
                    });
                }
            }
        }

        public string Id { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string Role { get; private set; }
        public string Signature { get; private set; }
        public IList<string> ComponentIds { get { return componentIds.AsReadOnly(); } }
        public int InstanceCount { get { return componentIds.Count; } }

        public Dictionary<string, object> ToMap()
        {
            var vectors = new List<double[]>();
            foreach (double[] vector in translationVectors)
            {
                vectors.Add(new[] { vector[0], vector[1] });
            }
            return EngineeringLineMaps.Map(
                "id", Id,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "role", Role,
                "topology_signature", Signature,
                "instance_count", InstanceCount,
                "component_ids", new List<string>(componentIds),
                "translations_from_first", vectors,
                "semantic_status", "repeated_geometry_candidate",
                "business_name_status", "not_inferred");
        }
    }

    public sealed class EngineeringSymmetryEvaluationRecord
    {
        readonly List<string> matchedHandlePairs;
        readonly List<string> shiftSources;

        internal EngineeringSymmetryEvaluationRecord(
            string id,
            EngineeringReferenceAxisObservation axis,
            string status,
            int featureCount,
            int matchedFeatureCount,
            double namedAxisCoverage,
            double bestCoverage,
            double rmsResidual,
            double maxResidual,
            double shiftX,
            double shiftY,
            double signedNormalOffset,
            IList<string> sources,
            IList<string> pairs)
        {
            Id = id;
            AxisHandle = axis.Handle;
            AxisName = axis.Name;
            OwnerScope = axis.OwnerScope;
            OwnerBlockName = axis.OwnerBlockName;
            Status = status;
            FeatureCount = featureCount;
            MatchedFeatureCount = matchedFeatureCount;
            NamedAxisCoverage = namedAxisCoverage;
            BestCoverage = bestCoverage;
            RmsResidual = rmsResidual;
            MaxResidual = maxResidual;
            ShiftX = shiftX;
            ShiftY = shiftY;
            SignedNormalOffset = signedNormalOffset;
            shiftSources = sources == null ? new List<string>() : new List<string>(sources);
            matchedHandlePairs = pairs == null ? new List<string>() : new List<string>(pairs);
        }

        public string Id { get; private set; }
        public string AxisHandle { get; private set; }
        public string AxisName { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string Status { get; private set; }
        public int FeatureCount { get; private set; }
        public int MatchedFeatureCount { get; private set; }
        public double NamedAxisCoverage { get; private set; }
        public double BestCoverage { get; private set; }
        public double RmsResidual { get; private set; }
        public double MaxResidual { get; private set; }
        public double ShiftX { get; private set; }
        public double ShiftY { get; private set; }
        public double SignedNormalOffset { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "id", Id,
                "reference_axis_handle", AxisHandle,
                "reference_axis_name", AxisName,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "symmetry_status", Status,
                "feature_count", FeatureCount,
                "matched_feature_count", MatchedFeatureCount,
                "named_axis_coverage", NamedAxisCoverage,
                "best_coverage", BestCoverage,
                "rms_residual", RmsResidual,
                "max_residual", MaxResidual,
                "best_axis_shift", new[] { ShiftX, ShiftY },
                "signed_normal_offset", SignedNormalOffset,
                "shift_sources", new List<string>(shiftSources),
                "matched_handle_pairs", new List<string>(matchedHandlePairs),
                "semantic_boundary", "symmetry_is_evaluated_from_geometry_not_declared_by_color");
        }
    }

    public sealed class EngineeringLineSemanticDocument
    {
        readonly List<EngineeringLayerStyleObservation> layerStyles;
        readonly List<EngineeringLinetypeCatalogRecord> linetypes;
        readonly List<EngineeringStyleProfileRecord> styleProfiles;
        readonly List<EngineeringStyleProfileRecord> unresolvedStyleProfiles;
        readonly List<EngineeringColorUsageRecord> colors;
        readonly List<EngineeringStrokeRecord> strokes;
        readonly List<EngineeringTopologyNodeRecord> nodes;
        readonly List<EngineeringTopologyComponentRecord> components;
        readonly List<EngineeringLineRelationRecord> relations;
        readonly List<EngineeringRepeatedPatternRecord> patterns;
        readonly List<EngineeringSymmetryEvaluationRecord> symmetryEvaluations;
        readonly Dictionary<string, int> roleCounts;
        readonly Dictionary<string, int> unsupportedGeometryCounts;

        internal EngineeringLineSemanticDocument(
            string drawingId,
            IList<EngineeringLayerStyleObservation> layerStyleValues,
            IList<EngineeringLinetypeCatalogRecord> linetypeValues,
            IList<EngineeringStyleProfileRecord> profileValues,
            IList<EngineeringStyleProfileRecord> unresolvedValues,
            IList<EngineeringColorUsageRecord> colorValues,
            IList<EngineeringStrokeRecord> strokeValues,
            IList<EngineeringTopologyNodeRecord> nodeValues,
            IList<EngineeringTopologyComponentRecord> componentValues,
            IList<EngineeringLineRelationRecord> relationValues,
            IList<EngineeringRepeatedPatternRecord> patternValues,
            IList<EngineeringSymmetryEvaluationRecord> symmetryValues,
            IDictionary<string, int> roles,
            IDictionary<string, int> unsupported)
        {
            DrawingId = drawingId ?? "";
            layerStyles = Copy(layerStyleValues);
            linetypes = Copy(linetypeValues);
            styleProfiles = Copy(profileValues);
            unresolvedStyleProfiles = Copy(unresolvedValues);
            colors = Copy(colorValues);
            strokes = Copy(strokeValues);
            nodes = Copy(nodeValues);
            components = Copy(componentValues);
            relations = Copy(relationValues);
            patterns = Copy(patternValues);
            symmetryEvaluations = Copy(symmetryValues);
            roleCounts = roles == null
                ? new Dictionary<string, int>(StringComparer.Ordinal)
                : new Dictionary<string, int>(roles, StringComparer.Ordinal);
            unsupportedGeometryCounts = unsupported == null
                ? new Dictionary<string, int>(StringComparer.Ordinal)
                : new Dictionary<string, int>(unsupported, StringComparer.Ordinal);
        }

        public string DrawingId { get; private set; }
        public IList<EngineeringLayerStyleObservation> LayerStyles
        {
            get { return layerStyles.AsReadOnly(); }
        }
        public IList<EngineeringLinetypeCatalogRecord> Linetypes { get { return linetypes.AsReadOnly(); } }
        public IList<EngineeringStyleProfileRecord> StyleProfiles { get { return styleProfiles.AsReadOnly(); } }
        public IList<EngineeringStyleProfileRecord> UnresolvedStyleProfiles
        {
            get { return unresolvedStyleProfiles.AsReadOnly(); }
        }
        public IList<EngineeringColorUsageRecord> Colors { get { return colors.AsReadOnly(); } }
        public IList<EngineeringStrokeRecord> Strokes { get { return strokes.AsReadOnly(); } }
        public IList<EngineeringTopologyNodeRecord> Nodes { get { return nodes.AsReadOnly(); } }
        public IList<EngineeringTopologyComponentRecord> Components
        {
            get { return components.AsReadOnly(); }
        }
        public IList<EngineeringLineRelationRecord> Relations { get { return relations.AsReadOnly(); } }
        public IList<EngineeringRepeatedPatternRecord> RepeatedPatterns
        {
            get { return patterns.AsReadOnly(); }
        }
        public IList<EngineeringSymmetryEvaluationRecord> SymmetryEvaluations
        {
            get { return symmetryEvaluations.AsReadOnly(); }
        }
        public IDictionary<string, int> RoleCounts
        {
            get { return new Dictionary<string, int>(roleCounts, StringComparer.Ordinal); }
        }
        public IDictionary<string, int> UnsupportedGeometryCounts
        {
            get
            {
                return new Dictionary<string, int>(
                    unsupportedGeometryCounts,
                    StringComparer.Ordinal);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return EngineeringLineMaps.Map(
                "schema_version", "1",
                "analysis_type", "engineering_line_semantics",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "layer_style_catalog_count", layerStyles.Count,
                "style_profile_count", styleProfiles.Count,
                "unresolved_style_profile_count", unresolvedStyleProfiles.Count,
                "color_usage_count", colors.Count,
                "linetype_catalog_count", linetypes.Count,
                "stroke_count", strokes.Count,
                "topology_node_count", nodes.Count,
                "topology_component_count", components.Count,
                "closed_contour_count", ClosedCount(),
                "relation_count", relations.Count,
                "repeated_pattern_count", patterns.Count,
                "symmetry_evaluation_count", symmetryEvaluations.Count,
                "role_counts", new Dictionary<string, int>(roleCounts, StringComparer.Ordinal),
                "unsupported_geometry_counts", new Dictionary<string, int>(
                    unsupportedGeometryCounts,
                    StringComparer.Ordinal),
                "layer_style_catalog", Maps(layerStyles),
                "linetype_catalog", Maps(linetypes),
                "color_usage", Maps(colors),
                "style_profiles", Maps(styleProfiles),
                "unresolved_style_profiles", Maps(unresolvedStyleProfiles),
                "strokes", Maps(strokes),
                "topology_nodes", Maps(nodes),
                "topology_components", Maps(components),
                "relations", Maps(relations),
                "repeated_patterns", Maps(patterns),
                "symmetry_evaluations", Maps(symmetryEvaluations),
                "open_vocabulary_policy", EngineeringLineMaps.Map(
                    "unknown_colors", "retained_with_usage_and_source_handles",
                    "unknown_linetypes", "retained_with_raw_pattern_and_other_family",
                    "unknown_style_combinations", "retained_in_unresolved_style_profiles",
                    "unused_layer_styles", "retained_in_layer_style_catalog",
                    "no_style_is_discarded", true),
                "semantic_boundary", EngineeringLineMaps.Map(
                    "exact", new[]
                    {
                        "entity_and_layer_style",
                        "ByLayer_resolution",
                        "raw_linetype_dash_pattern",
                        "database_curve_geometry",
                        "endpoint_coincidence"
                    },
                    "derived", new[]
                    {
                        "engineering_line_role_candidates",
                        "connected_components",
                        "closed_contour_candidates",
                        "containment_candidates",
                        "repeated_topology",
                        "geometry_symmetry_evaluation"
                    },
                    "not_inferred", new[]
                    {
                        "component_business_name",
                        "material_from_hatching_alone",
                        "phantom_line_business_purpose_without_context"
                    }));
        }

        public string ToMarkdown()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 工程图线语义与轮廓拓扑");
            sb.AppendLine();
            sb.AppendLine("- 图纸：`" + DrawingId + "`");
            sb.AppendLine("- 图层样式定义：" + layerStyles.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 图线实体：" + strokes.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 样式画像：" + styleProfiles.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 待后续分析样式：" + unresolvedStyleProfiles.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 连通分量：" + components.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 闭合轮廓候选：" + ClosedCount().ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 重复拓扑候选：" + patterns.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine();
            sb.AppendLine("## 语义角色");
            sb.AppendLine();
            foreach (KeyValuePair<string, int> pair in Sorted(roleCounts))
            {
                sb.AppendLine("- `" + pair.Key + "`："
                    + pair.Value.ToString(CultureInfo.InvariantCulture));
            }
            sb.AppendLine();
            if (unresolvedStyleProfiles.Count > 0)
            {
                sb.AppendLine("## 开放词汇保留");
                sb.AppendLine();
                sb.AppendLine("以下样式没有被丢弃；它们保留原始颜色、线型、图层、实体类型和样本句柄，等待新图纸证据补充分组：");
                foreach (EngineeringStyleProfileRecord profile in unresolvedStyleProfiles)
                {
                    sb.AppendLine("- `" + profile.Id + "`：层 `" + profile.Layer
                        + "`，颜色 `" + profile.EffectiveColorName
                        + "`，线型 `" + profile.EffectiveLinetype
                        + "`，族 `" + profile.LinetypeFamily
                        + "`，实体 " + profile.EntityCount.ToString(CultureInfo.InvariantCulture));
                }
                sb.AppendLine();
            }
            if (symmetryEvaluations.Count > 0)
            {
                sb.AppendLine("## 参考轴对称评估");
                sb.AppendLine();
                foreach (EngineeringSymmetryEvaluationRecord evaluation in symmetryEvaluations)
                {
                    sb.AppendLine("- `" + evaluation.AxisHandle + "` "
                        + evaluation.AxisName + "：" + evaluation.Status
                        + "，最佳覆盖率 " + Format(evaluation.BestCoverage)
                        + "，法向偏置 " + Format(evaluation.SignedNormalOffset));
                }
                sb.AppendLine();
            }
            sb.AppendLine("## 边界");
            sb.AppendLine();
            sb.AppendLine("颜色只作为证据；有效线型、图层、实体覆盖、几何拓扑及已有 07–09 证据共同决定候选语义。未知样式完整保留，不强制归类。");
            return sb.ToString().TrimEnd();
        }

        int ClosedCount()
        {
            int count = 0;
            foreach (EngineeringTopologyComponentRecord component in components)
            {
                if (component.IsClosed) { count++; }
            }
            return count;
        }

        static List<T> Copy<T>(IList<T> values)
        {
            return values == null ? new List<T>() : new List<T>(values);
        }

        static List<Dictionary<string, object>> Maps<T>(IList<T> values)
        {
            var result = new List<Dictionary<string, object>>();
            if (values == null) { return result; }
            foreach (T item in values)
            {
                object value = item;
                EngineeringLayerStyleObservation layerStyle = value as EngineeringLayerStyleObservation;
                if (layerStyle != null) { result.Add(layerStyle.ToMap()); continue; }
                EngineeringLinetypeCatalogRecord linetype = value as EngineeringLinetypeCatalogRecord;
                if (linetype != null) { result.Add(linetype.ToMap()); continue; }
                EngineeringStyleProfileRecord profile = value as EngineeringStyleProfileRecord;
                if (profile != null) { result.Add(profile.ToMap()); continue; }
                EngineeringColorUsageRecord color = value as EngineeringColorUsageRecord;
                if (color != null) { result.Add(color.ToMap()); continue; }
                EngineeringStrokeRecord stroke = value as EngineeringStrokeRecord;
                if (stroke != null) { result.Add(stroke.ToMap()); continue; }
                EngineeringTopologyNodeRecord node = value as EngineeringTopologyNodeRecord;
                if (node != null) { result.Add(node.ToMap()); continue; }
                EngineeringTopologyComponentRecord component = value as EngineeringTopologyComponentRecord;
                if (component != null) { result.Add(component.ToMap()); continue; }
                EngineeringLineRelationRecord relation = value as EngineeringLineRelationRecord;
                if (relation != null) { result.Add(relation.ToMap()); continue; }
                EngineeringRepeatedPatternRecord pattern = value as EngineeringRepeatedPatternRecord;
                if (pattern != null) { result.Add(pattern.ToMap()); continue; }
                EngineeringSymmetryEvaluationRecord symmetry = value as EngineeringSymmetryEvaluationRecord;
                if (symmetry != null) { result.Add(symmetry.ToMap()); }
            }
            return result;
        }

        static List<KeyValuePair<string, int>> Sorted(IDictionary<string, int> values)
        {
            var result = new List<KeyValuePair<string, int>>(values);
            result.Sort(delegate(KeyValuePair<string, int> left, KeyValuePair<string, int> right)
            {
                int count = right.Value.CompareTo(left.Value);
                return count != 0 ? count : string.CompareOrdinal(left.Key, right.Key);
            });
            return result;
        }

        static string Format(double value)
        {
            return value.ToString("0.######", CultureInfo.InvariantCulture);
        }
    }

    internal sealed class ResolvedEngineeringStyle
    {
        public string Layer;
        public string ColorName;
        public bool HasColorIndex;
        public int ColorIndex;
        public bool HasRgb;
        public int Red;
        public int Green;
        public int Blue;
        public string ColorSource;
        public string ColorResolutionStatus;
        public string Linetype;
        public string LinetypeFamily;
        public string LinetypeSource;
        public string LinetypeResolutionStatus;
        public bool HasLineweight;
        public int Lineweight;
        public string LineweightSource;
        public string LineweightResolutionStatus;
    }

    internal sealed class EngineeringRoleAnalysis
    {
        public EngineeringRoleAnalysis()
        {
            Candidates = new List<string>();
            Evidence = new List<string>();
            PrimaryRole = "unclassified";
            Status = "unresolved";
        }

        public string PrimaryRole;
        public string Status;
        public readonly List<string> Candidates;
        public readonly List<string> Evidence;

        public void Add(string role, string evidence)
        {
            if (!Candidates.Contains(role)) { Candidates.Add(role); }
            if (!string.IsNullOrEmpty(evidence) && !Evidence.Contains(evidence))
            {
                Evidence.Add(evidence);
            }
        }
    }

    public static class EngineeringLineSemanticAnalyzer
    {
        sealed class AnalyzedObservation
        {
            public EngineeringLineObservation Observation;
            public ResolvedEngineeringStyle Style;
            public EngineeringRoleAnalysis Role;
            public EngineeringStyleProfileRecord Profile;
        }

        sealed class DisjointSet
        {
            readonly int[] parent;

            public DisjointSet(int count)
            {
                parent = new int[count];
                for (int index = 0; index < count; index++) { parent[index] = index; }
            }

            public int Find(int value)
            {
                if (parent[value] != value) { parent[value] = Find(parent[value]); }
                return parent[value];
            }

            public void Union(int left, int right)
            {
                int a = Find(left);
                int b = Find(right);
                if (a != b) { parent[b] = a; }
            }
        }

        sealed class NodeBuilder
        {
            public EngineeringTopologyNodeRecord Node;
            public readonly List<int> StrokeIndexes = new List<int>();
        }

        sealed class ShiftCandidate
        {
            public double ShiftX;
            public double ShiftY;
            public readonly List<string> Sources = new List<string>();
        }

        sealed class SymmetryCandidateResult
        {
            public ShiftCandidate Shift;
            public int FeatureCount;
            public int MatchedCount;
            public double Coverage;
            public double RmsResidual;
            public double MaxResidual;
            public readonly List<string> PairSamples = new List<string>();
        }

        public static EngineeringLineSemanticDocument Analyze(
            string drawingId,
            IList<EngineeringLineObservation> observations,
            IList<EngineeringLayerStyleObservation> layers,
            IList<EngineeringLinetypeDefinitionObservation> linetypeDefinitions,
            IList<string> annotationHandles,
            IList<string> centerGeometryHandles,
            IList<EngineeringReferenceAxisObservation> referenceAxes,
            EngineeringLineSemanticConfig config = null)
        {
            config = config ?? new EngineeringLineSemanticConfig();
            var layerByName = LayerMap(layers);
            var linetypeByName = BuildLinetypeCatalog(linetypeDefinitions);
            var annotationSet = Set(annotationHandles);
            var centerSet = Set(centerGeometryHandles);
            var profileByKey = new Dictionary<string, EngineeringStyleProfileRecord>(
                StringComparer.Ordinal);
            var colorByKey = new Dictionary<string, EngineeringColorUsageRecord>(
                StringComparer.Ordinal);
            var analyzed = new List<AnalyzedObservation>();
            var roleCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var unsupported = new Dictionary<string, int>(StringComparer.Ordinal);

            if (observations != null)
            {
                foreach (EngineeringLineObservation observation in observations)
                {
                    if (observation == null) { continue; }
                    ResolvedEngineeringStyle style = ResolveStyle(
                        observation,
                        layerByName,
                        linetypeByName);
                    EngineeringRoleAnalysis role = AnalyzeRole(
                        observation,
                        style,
                        annotationSet,
                        centerSet);
                    string profileKey = ProfileKey(style, role);
                    EngineeringStyleProfileRecord profile;
                    if (!profileByKey.TryGetValue(profileKey, out profile))
                    {
                        profile = new EngineeringStyleProfileRecord(profileKey, style, role);
                        profileByKey[profileKey] = profile;
                    }
                    profile.Add(observation, config.SampleHandleLimit);
                    string colorKey = ColorKey(style);
                    EngineeringColorUsageRecord color;
                    if (!colorByKey.TryGetValue(colorKey, out color))
                    {
                        color = new EngineeringColorUsageRecord(style);
                        colorByKey[colorKey] = color;
                    }
                    color.Add(observation, role.PrimaryRole, config.SampleHandleLimit);
                    Increment(roleCounts, role.PrimaryRole);
                    EngineeringLinetypeCatalogRecord linetype;
                    if (!linetypeByName.TryGetValue(style.Linetype, out linetype))
                    {
                        linetype = NewUndefinedLinetype(style.Linetype);
                        linetypeByName[style.Linetype] = linetype;
                    }
                    linetype.EntityUsageCount++;
                    analyzed.Add(new AnalyzedObservation
                    {
                        Observation = observation,
                        Style = style,
                        Role = role,
                        Profile = profile
                    });
                    if (!observation.IsCurveLike
                        && IsGeometryLikeName(observation.GeometryKind))
                    {
                        Increment(unsupported, observation.GeometryKind);
                    }
                }
            }

            var profiles = new List<EngineeringStyleProfileRecord>(profileByKey.Values);
            profiles.Sort(delegate(
                EngineeringStyleProfileRecord left,
                EngineeringStyleProfileRecord right)
            {
                return string.CompareOrdinal(left.Key, right.Key);
            });
            for (int index = 0; index < profiles.Count; index++)
            {
                profiles[index].Id = "engineering-style-profile-"
                    + (index + 1).ToString(CultureInfo.InvariantCulture);
            }

            var unresolvedProfiles = new List<EngineeringStyleProfileRecord>();
            foreach (EngineeringStyleProfileRecord profile in profiles)
            {
                if (profile.RequiresFutureAnalysis) { unresolvedProfiles.Add(profile); }
            }

            var colors = new List<EngineeringColorUsageRecord>(colorByKey.Values);
            colors.Sort(delegate(
                EngineeringColorUsageRecord left,
                EngineeringColorUsageRecord right)
            {
                int count = right.EntityCount.CompareTo(left.EntityCount);
                return count != 0 ? count : string.CompareOrdinal(left.Name, right.Name);
            });

            var linetypes = new List<EngineeringLinetypeCatalogRecord>(linetypeByName.Values);
            linetypes.Sort(delegate(
                EngineeringLinetypeCatalogRecord left,
                EngineeringLinetypeCatalogRecord right)
            {
                int count = right.EntityUsageCount.CompareTo(left.EntityUsageCount);
                return count != 0 ? count : string.CompareOrdinal(left.Name, right.Name);
            });

            var strokes = new List<EngineeringStrokeRecord>();
            foreach (AnalyzedObservation item in analyzed)
            {
                if (item.Observation.IsCurveLike)
                {
                    strokes.Add(new EngineeringStrokeRecord(
                        item.Observation,
                        item.Profile,
                        item.Role));
                }
            }
            strokes.Sort(delegate(EngineeringStrokeRecord left, EngineeringStrokeRecord right)
            {
                int owner = string.CompareOrdinal(left.OwnerScope, right.OwnerScope);
                if (owner != 0) { return owner; }
                int block = string.CompareOrdinal(left.OwnerBlockName, right.OwnerBlockName);
                return block != 0 ? block : string.CompareOrdinal(left.Handle, right.Handle);
            });

            List<EngineeringTopologyNodeRecord> nodes;
            List<EngineeringTopologyComponentRecord> components;
            BuildTopology(strokes, config, out nodes, out components);
            List<EngineeringLineRelationRecord> relations = BuildRelations(
                components,
                config);
            List<EngineeringRepeatedPatternRecord> patterns = BuildRepeatedPatterns(
                components,
                config);
            List<EngineeringSymmetryEvaluationRecord> symmetry = EvaluateSymmetry(
                strokes,
                components,
                referenceAxes,
                config);

            return new EngineeringLineSemanticDocument(
                drawingId,
                layers,
                linetypes,
                profiles,
                unresolvedProfiles,
                colors,
                strokes,
                nodes,
                components,
                relations,
                patterns,
                symmetry,
                roleCounts,
                unsupported);
        }

        static Dictionary<string, EngineeringLayerStyleObservation> LayerMap(
            IList<EngineeringLayerStyleObservation> layers)
        {
            var result = new Dictionary<string, EngineeringLayerStyleObservation>(
                StringComparer.Ordinal);
            if (layers == null) { return result; }
            foreach (EngineeringLayerStyleObservation layer in layers)
            {
                if (layer != null) { result[layer.Name] = layer; }
            }
            return result;
        }

        static Dictionary<string, EngineeringLinetypeCatalogRecord> BuildLinetypeCatalog(
            IList<EngineeringLinetypeDefinitionObservation> definitions)
        {
            var result = new Dictionary<string, EngineeringLinetypeCatalogRecord>(
                StringComparer.OrdinalIgnoreCase);
            if (definitions == null) { return result; }
            foreach (EngineeringLinetypeDefinitionObservation definition in definitions)
            {
                if (definition == null) { continue; }
                var evidence = new List<string>();
                string family = ClassifyLinetypeFamily(
                    definition.Name,
                    definition.DashLengths,
                    evidence);
                result[definition.Name] = new EngineeringLinetypeCatalogRecord(
                    definition.Name,
                    true,
                    definition.AsciiDescription,
                    definition.Comments,
                    definition.HasPatternLength
                        ? (double?)definition.PatternLength
                        : null,
                    definition.DashLengths,
                    family,
                    evidence);
            }
            return result;
        }

        static EngineeringLinetypeCatalogRecord NewUndefinedLinetype(string name)
        {
            var evidence = new List<string>();
            string family = ClassifyLinetypeFamily(
                name,
                new List<double>(),
                evidence);
            evidence.Add("linetype_definition_not_present_in_input_catalog");
            return new EngineeringLinetypeCatalogRecord(
                name,
                false,
                "",
                "",
                null,
                new List<double>(),
                family,
                evidence);
        }

        static ResolvedEngineeringStyle ResolveStyle(
            EngineeringLineObservation observation,
            IDictionary<string, EngineeringLayerStyleObservation> layers,
            IDictionary<string, EngineeringLinetypeCatalogRecord> linetypes)
        {
            EngineeringLayerStyleObservation layer;
            layers.TryGetValue(observation.Layer, out layer);
            var result = new ResolvedEngineeringStyle();
            result.Layer = observation.Layer;

            if (observation.EntityColorIsByBlock)
            {
                result.ColorName = observation.EntityColorName;
                result.HasColorIndex = observation.HasEntityColorIndex;
                result.ColorIndex = observation.EntityColorIndex;
                result.ColorSource = "entity_ByBlock";
                result.ColorResolutionStatus = "requires_block_instance";
            }
            else if (observation.EntityColorIsByLayer || !observation.HasEntityColorIndex)
            {
                if (layer != null)
                {
                    result.ColorName = layer.ColorName;
                    result.HasColorIndex = layer.HasColorIndex;
                    result.ColorIndex = layer.ColorIndex;
                    result.HasRgb = layer.HasRgb;
                    result.Red = layer.Red;
                    result.Green = layer.Green;
                    result.Blue = layer.Blue;
                    result.ColorSource = "layer";
                    result.ColorResolutionStatus = "resolved";
                }
                else
                {
                    result.ColorName = observation.EntityColorName;
                    result.ColorSource = "missing_layer_definition";
                    result.ColorResolutionStatus = "unresolved";
                }
            }
            else
            {
                result.ColorName = observation.EntityColorName;
                result.HasColorIndex = observation.HasEntityColorIndex;
                result.ColorIndex = observation.EntityColorIndex;
                result.HasRgb = observation.HasEntityRgb;
                result.Red = observation.EntityRed;
                result.Green = observation.EntityGreen;
                result.Blue = observation.EntityBlue;
                result.ColorSource = "entity_override";
                result.ColorResolutionStatus = "resolved";
            }
            if (string.IsNullOrEmpty(result.ColorName) && result.HasRgb)
            {
                result.ColorName = "rgb("
                    + result.Red.ToString(CultureInfo.InvariantCulture) + ","
                    + result.Green.ToString(CultureInfo.InvariantCulture) + ","
                    + result.Blue.ToString(CultureInfo.InvariantCulture) + ")";
            }

            string rawLinetype = observation.EntityLinetype ?? "";
            if (string.Equals(rawLinetype, "ByBlock", StringComparison.OrdinalIgnoreCase))
            {
                result.Linetype = rawLinetype;
                result.LinetypeSource = "entity_ByBlock";
                result.LinetypeResolutionStatus = "requires_block_instance";
            }
            else if (string.IsNullOrEmpty(rawLinetype)
                || string.Equals(rawLinetype, "ByLayer", StringComparison.OrdinalIgnoreCase))
            {
                if (layer != null && !string.IsNullOrEmpty(layer.Linetype))
                {
                    result.Linetype = layer.Linetype;
                    result.LinetypeSource = "layer";
                    result.LinetypeResolutionStatus = "resolved";
                }
                else
                {
                    result.Linetype = rawLinetype;
                    result.LinetypeSource = "missing_layer_definition";
                    result.LinetypeResolutionStatus = "unresolved";
                }
            }
            else
            {
                result.Linetype = rawLinetype;
                result.LinetypeSource = "entity_override";
                result.LinetypeResolutionStatus = "resolved";
            }
            EngineeringLinetypeCatalogRecord record;
            if (linetypes.TryGetValue(result.Linetype ?? "", out record))
            {
                result.LinetypeFamily = record.Family;
            }
            else
            {
                var evidence = new List<string>();
                result.LinetypeFamily = ClassifyLinetypeFamily(
                    result.Linetype,
                    new List<double>(),
                    evidence);
            }

            if (observation.HasEntityLineweight && observation.EntityLineweight >= 0)
            {
                result.HasLineweight = true;
                result.Lineweight = observation.EntityLineweight;
                result.LineweightSource = "entity_override";
                result.LineweightResolutionStatus = "resolved";
            }
            else if (observation.HasEntityLineweight
                && observation.EntityLineweight == -2)
            {
                result.LineweightSource = "entity_ByBlock";
                result.LineweightResolutionStatus = "requires_block_instance";
            }
            else if (layer != null && layer.HasLineweight && layer.Lineweight >= 0)
            {
                result.HasLineweight = true;
                result.Lineweight = layer.Lineweight;
                result.LineweightSource = "layer";
                result.LineweightResolutionStatus = "resolved";
            }
            else if (observation.HasEntityLineweight
                && observation.EntityLineweight == -3)
            {
                result.LineweightSource = "drawing_default";
                result.LineweightResolutionStatus = "default_not_expanded";
            }
            else
            {
                result.LineweightSource = layer == null
                    ? "missing_layer_definition"
                    : "ByLayer_without_numeric_layer_lineweight";
                result.LineweightResolutionStatus = "unresolved";
            }
            if (string.Equals(
                    observation.OwnerScope,
                    "block_definition",
                    StringComparison.Ordinal)
                && string.Equals(observation.Layer, "0", StringComparison.Ordinal)
                && observation.EntityColorIsByLayer)
            {
                result.ColorSource = "nominal_layer0_in_block_definition";
                result.ColorResolutionStatus = "requires_block_instance";
            }
            if (string.Equals(
                    observation.OwnerScope,
                    "block_definition",
                    StringComparison.Ordinal)
                && string.Equals(observation.Layer, "0", StringComparison.Ordinal)
                && (string.IsNullOrEmpty(rawLinetype)
                    || string.Equals(rawLinetype, "ByLayer", StringComparison.OrdinalIgnoreCase)))
            {
                result.LinetypeSource = "nominal_layer0_in_block_definition";
                result.LinetypeResolutionStatus = "requires_block_instance";
            }
            return result;
        }

        static EngineeringRoleAnalysis AnalyzeRole(
            EngineeringLineObservation observation,
            ResolvedEngineeringStyle style,
            ISet<string> annotationHandles,
            ISet<string> centerHandles)
        {
            var result = new EngineeringRoleAnalysis();
            string layer = observation.Layer ?? "";
            if (annotationHandles.Contains(observation.Handle)
                || Contains(layer, "标注")
                || IsAnnotationRuntime(observation))
            {
                result.Add("annotation_geometry", annotationHandles.Contains(observation.Handle)
                    ? "handle_recognized_by_08_annotation_identification"
                    : "annotation_entity_or_layer_signal");
            }
            if (centerHandles.Contains(observation.Handle)
                || style.LinetypeFamily == "center_chain"
                || Contains(layer, "中心线"))
            {
                result.Add("center_reference", centerHandles.Contains(observation.Handle)
                    ? "handle_recognized_by_07_centerline_identification"
                    : "center_linetype_or_layer_signal");
            }
            if (style.LinetypeFamily == "double_chain" || Contains(layer, "双点划"))
            {
                result.Add("double_chain_reference", style.LinetypeFamily == "double_chain"
                    ? "effective_linetype_is_double_chain_family"
                    : "layer_name_contains_double_chain_marker");
            }
            if (style.LinetypeFamily == "dashed" || Contains(layer, "虚线"))
            {
                result.Add("hidden_contour", style.LinetypeFamily == "dashed"
                    ? "effective_linetype_is_dashed_family"
                    : "layer_name_contains_hidden_line_marker");
            }
            if (Contains(layer, "剖面") || observation.ManagedType == "Hatch")
            {
                result.Add("section_hatching", Contains(layer, "剖面")
                    ? "layer_name_contains_section_marker"
                    : "native_hatch_entity");
            }
            if ((Contains(layer, "轮廓") || Contains(layer, "粗实线"))
                && style.LinetypeFamily == "continuous")
            {
                result.Add("visible_contour", "continuous_geometry_on_contour_layer");
            }
            if (Contains(layer, "细线") && style.LinetypeFamily == "continuous")
            {
                result.Add("thin_auxiliary", "continuous_geometry_on_thin_line_layer");
            }
            if (result.Candidates.Count == 0
                && observation.IsCurveLike
                && style.LinetypeFamily == "continuous")
            {
                result.Add(
                    "continuous_geometry_candidate",
                    "continuous_curve_without_known_business_layer_signal");
            }

            string[] priority =
            {
                "annotation_geometry",
                "center_reference",
                "double_chain_reference",
                "hidden_contour",
                "section_hatching",
                "visible_contour",
                "thin_auxiliary",
                "continuous_geometry_candidate"
            };
            foreach (string role in priority)
            {
                if (result.Candidates.Contains(role))
                {
                    result.PrimaryRole = role;
                    break;
                }
            }
            if (result.PrimaryRole == "continuous_geometry_candidate")
            {
                result.Status = "candidate_without_business_layer_signal";
            }
            else if (result.Candidates.Count == 1)
            {
                result.Status = "resolved";
            }
            else if (result.Candidates.Count > 1)
            {
                result.Status = "multiple_role_signals_retained";
                result.Evidence.Add("primary_role_uses_precedence_but_all_candidates_are_preserved");
            }
            else
            {
                result.Evidence.Add("no_known_role_signal_matched");
            }
            return result;
        }

        static string ClassifyLinetypeFamily(
            string name,
            IList<double> dashes,
            IList<string> evidence)
        {
            string upper = (name ?? "").ToUpperInvariant();
            if (upper == "CONTINUOUS" || upper == "BYLAYER" && dashes.Count == 0)
            {
                evidence.Add("linetype_name_continuous");
                return "continuous";
            }
            if (upper.IndexOf("PHANTOM", StringComparison.Ordinal) >= 0
                || upper.IndexOf("DIVIDE", StringComparison.Ordinal) >= 0
                || upper == "K")
            {
                evidence.Add("linetype_name_double_chain_family");
                return "double_chain";
            }
            if (upper.IndexOf("CENTER", StringComparison.Ordinal) >= 0
                || upper.IndexOf("CENTRE", StringComparison.Ordinal) >= 0
                || upper.IndexOf("ISO04", StringComparison.Ordinal) >= 0)
            {
                evidence.Add("linetype_name_center_chain_family");
                return "center_chain";
            }
            if (upper.IndexOf("DASH", StringComparison.Ordinal) >= 0
                || upper.IndexOf("HIDDEN", StringComparison.Ordinal) >= 0)
            {
                evidence.Add("linetype_name_dashed_family");
                return "dashed";
            }
            if (dashes != null && dashes.Count > 0)
            {
                int drawn = 0;
                int dots = 0;
                double longest = 0;
                double shortestPositive = double.PositiveInfinity;
                foreach (double dash in dashes)
                {
                    if (dash > 0)
                    {
                        drawn++;
                        longest = Math.Max(longest, dash);
                        shortestPositive = Math.Min(shortestPositive, dash);
                    }
                    else if (Math.Abs(dash) <= 0.0000001)
                    {
                        dots++;
                    }
                }
                if (dots >= 2 || drawn >= 3)
                {
                    evidence.Add("dash_pattern_contains_long_and_two_short_or_dot_elements");
                    return "double_chain";
                }
                if (dots == 1
                    || drawn == 2 && shortestPositive < longest * 0.6)
                {
                    evidence.Add("dash_pattern_contains_long_and_single_short_or_dot_element");
                    return "center_chain";
                }
                if (drawn == 1)
                {
                    evidence.Add("dash_pattern_contains_single_drawn_segment_per_cycle");
                    return "dashed";
                }
            }
            if (string.IsNullOrEmpty(name))
            {
                evidence.Add("linetype_name_missing");
            }
            else
            {
                evidence.Add("linetype_name_and_pattern_not_in_known_families");
            }
            return "other";
        }

        static void BuildTopology(
            IList<EngineeringStrokeRecord> strokes,
            EngineeringLineSemanticConfig config,
            out List<EngineeringTopologyNodeRecord> nodes,
            out List<EngineeringTopologyComponentRecord> components)
        {
            nodes = new List<EngineeringTopologyNodeRecord>();
            components = new List<EngineeringTopologyComponentRecord>();
            var groupIndexes = new Dictionary<string, List<int>>(StringComparer.Ordinal);
            for (int index = 0; index < strokes.Count; index++)
            {
                EngineeringStrokeRecord stroke = strokes[index];
                if (!stroke.TopologyEligible) { continue; }
                string key = SpaceKey(stroke.OwnerScope, stroke.OwnerBlockName)
                    + "|" + stroke.PrimaryRole;
                List<int> indexes;
                if (!groupIndexes.TryGetValue(key, out indexes))
                {
                    indexes = new List<int>();
                    groupIndexes[key] = indexes;
                }
                indexes.Add(index);
            }
            var keys = new List<string>(groupIndexes.Keys);
            keys.Sort(StringComparer.Ordinal);
            int nodeNumber = 0;
            foreach (string key in keys)
            {
                List<int> indexes = groupIndexes[key];
                if (indexes.Count == 0) { continue; }
                var localSet = new DisjointSet(indexes.Count);
                var localNodes = new List<NodeBuilder>();
                var localNodeCells = new Dictionary<string, List<NodeBuilder>>(
                    StringComparer.Ordinal);
                for (int local = 0; local < indexes.Count; local++)
                {
                    EngineeringStrokeRecord stroke = strokes[indexes[local]];
                    if (!stroke.HasEndpoints || stroke.IsClosed) { continue; }
                    AddEndpoint(
                        stroke.StartX,
                        stroke.StartY,
                        local,
                        stroke,
                        localNodes,
                        localNodeCells,
                        localSet,
                        config.GeometryTolerance,
                        ref nodeNumber);
                    AddEndpoint(
                        stroke.EndX,
                        stroke.EndY,
                        local,
                        stroke,
                        localNodes,
                        localNodeCells,
                        localSet,
                        config.GeometryTolerance,
                        ref nodeNumber);
                }

                var componentIndexes = new Dictionary<int, List<int>>();
                for (int local = 0; local < indexes.Count; local++)
                {
                    int root = localSet.Find(local);
                    List<int> values;
                    if (!componentIndexes.TryGetValue(root, out values))
                    {
                        values = new List<int>();
                        componentIndexes[root] = values;
                    }
                    values.Add(local);
                }
                var componentLists = new List<List<int>>(componentIndexes.Values);
                componentLists.Sort(delegate(List<int> left, List<int> right)
                {
                    return string.CompareOrdinal(
                        strokes[indexes[left[0]]].Handle,
                        strokes[indexes[right[0]]].Handle);
                });
                foreach (List<int> localComponent in componentLists)
                {
                    EngineeringStrokeRecord sample = strokes[indexes[localComponent[0]]];
                    var component = new EngineeringTopologyComponentRecord(
                        "engineering-topology-component-"
                            + (components.Count + 1).ToString(CultureInfo.InvariantCulture),
                        sample.OwnerScope,
                        sample.OwnerBlockName,
                        sample.PrimaryRole);
                    var localMemberSet = new HashSet<int>(localComponent);
                    bool hasOpenStroke = false;
                    bool allClosedStrokes = true;
                    foreach (int local in localComponent)
                    {
                        EngineeringStrokeRecord stroke = strokes[indexes[local]];
                        component.AddStroke(stroke);
                        stroke.TopologyComponentId = component.Id;
                        if (!stroke.IsClosed)
                        {
                            hasOpenStroke = true;
                            allClosedStrokes = false;
                        }
                    }
                    bool allDegreeTwo = hasOpenStroke;
                    foreach (NodeBuilder builder in localNodes)
                    {
                        bool belongs = false;
                        foreach (int local in builder.StrokeIndexes)
                        {
                            if (localMemberSet.Contains(local))
                            {
                                belongs = true;
                                break;
                            }
                        }
                        if (!belongs) { continue; }
                        component.AddNode(builder.Node.Id);
                        if (builder.Node.Degree == 1) { component.OpenEndCount++; }
                        if (builder.Node.Degree > 2) { component.BranchNodeCount++; }
                        if (builder.Node.Degree != 2) { allDegreeTwo = false; }
                    }
                    component.IsClosed = allClosedStrokes || allDegreeTwo;
                    components.Add(component);
                }
                foreach (NodeBuilder builder in localNodes)
                {
                    nodes.Add(builder.Node);
                }
            }
        }

        static void AddEndpoint(
            double x,
            double y,
            int localStrokeIndex,
            EngineeringStrokeRecord stroke,
            IList<NodeBuilder> nodes,
            IDictionary<string, List<NodeBuilder>> nodeCells,
            DisjointSet set,
            double tolerance,
            ref int nodeNumber)
        {
            NodeBuilder matched = null;
            double cellSize = tolerance > 0 ? tolerance : 0.000001;
            long cellX = (long)Math.Floor(x / cellSize);
            long cellY = (long)Math.Floor(y / cellSize);
            for (long offsetX = -1; offsetX <= 1 && matched == null; offsetX++)
            {
                for (long offsetY = -1; offsetY <= 1 && matched == null; offsetY++)
                {
                    List<NodeBuilder> candidates;
                    if (!nodeCells.TryGetValue(
                        NodeCellKey(cellX + offsetX, cellY + offsetY),
                        out candidates))
                    {
                        continue;
                    }
                    foreach (NodeBuilder candidate in candidates)
                    {
                        if (Distance(x, y, candidate.Node.X, candidate.Node.Y) <= tolerance)
                        {
                            matched = candidate;
                            break;
                        }
                    }
                }
            }
            if (matched == null)
            {
                nodeNumber++;
                matched = new NodeBuilder
                {
                    Node = new EngineeringTopologyNodeRecord(
                        "engineering-topology-node-"
                            + nodeNumber.ToString(CultureInfo.InvariantCulture),
                        stroke.OwnerScope,
                        stroke.OwnerBlockName,
                        stroke.PrimaryRole,
                        x,
                        y)
                };
                nodes.Add(matched);
                string cellKey = NodeCellKey(cellX, cellY);
                List<NodeBuilder> cell;
                if (!nodeCells.TryGetValue(cellKey, out cell))
                {
                    cell = new List<NodeBuilder>();
                    nodeCells[cellKey] = cell;
                }
                cell.Add(matched);
            }
            else
            {
                int count = matched.Node.Degree;
                matched.Node.X = (matched.Node.X * count + x) / (count + 1);
                matched.Node.Y = (matched.Node.Y * count + y) / (count + 1);
            }
            foreach (int existing in matched.StrokeIndexes)
            {
                set.Union(localStrokeIndex, existing);
            }
            if (!matched.StrokeIndexes.Contains(localStrokeIndex))
            {
                matched.StrokeIndexes.Add(localStrokeIndex);
                matched.Node.Add(stroke.Handle);
            }
        }

        static string NodeCellKey(long x, long y)
        {
            return x.ToString(CultureInfo.InvariantCulture)
                + ":"
                + y.ToString(CultureInfo.InvariantCulture);
        }

        static List<EngineeringLineRelationRecord> BuildRelations(
            IList<EngineeringTopologyComponentRecord> components,
            EngineeringLineSemanticConfig config)
        {
            var result = new List<EngineeringLineRelationRecord>();
            foreach (EngineeringTopologyComponentRecord child in components)
            {
                if (child.Role != "hidden_contour"
                    && child.Role != "section_hatching"
                    && child.Role != "double_chain_reference")
                {
                    continue;
                }
                EngineeringTopologyComponentRecord best = null;
                double bestArea = double.PositiveInfinity;
                foreach (EngineeringTopologyComponentRecord parent in components)
                {
                    if (parent.Role != "visible_contour"
                            && parent.Role != "continuous_geometry_candidate"
                        || !parent.IsClosed
                        || !SameSpace(parent, child)
                        || parent == child
                        || !parent.ContainsBounds(child, config.GeometryTolerance))
                    {
                        continue;
                    }
                    double area = Math.Abs(parent.Width * parent.Height);
                    double childArea = Math.Abs(child.Width * child.Height);
                    if (area <= childArea || area >= bestArea) { continue; }
                    best = parent;
                    bestArea = area;
                }
                if (best == null) { continue; }
                string envelope = best.Role == "visible_contour"
                    ? "visible_envelope"
                    : "continuous_envelope";
                string type = child.Role == "hidden_contour"
                    ? "hidden_inside_" + envelope + "_candidate"
                    : child.Role == "section_hatching"
                        ? "section_inside_" + envelope + "_candidate"
                        : "double_chain_inside_" + envelope + "_candidate";
                var relation = new EngineeringLineRelationRecord(
                    "engineering-line-relation-"
                        + (result.Count + 1).ToString(CultureInfo.InvariantCulture),
                    type,
                    child.Id,
                    best.Id);
                relation.AddEvidence("same_owner_coordinate_space");
                relation.AddEvidence("child_bounds_inside_closed_continuous_component_bounds");
                relation.AddEvidence("smallest_containing_continuous_component_selected");
                relation.AddEvidence("parent_role:" + best.Role);
                result.Add(relation);
            }
            return result;
        }

        static List<EngineeringRepeatedPatternRecord> BuildRepeatedPatterns(
            IList<EngineeringTopologyComponentRecord> components,
            EngineeringLineSemanticConfig config)
        {
            var groups = new Dictionary<string, List<EngineeringTopologyComponentRecord>>(
                StringComparer.Ordinal);
            foreach (EngineeringTopologyComponentRecord component in components)
            {
                if (component.Role == "annotation_geometry"
                    || component.Role == "section_hatching"
                    || component.Role == "unclassified"
                    || component.StrokeCount < 2 && !component.IsClosed)
                {
                    continue;
                }
                string signature = ComponentSignature(component, config.RepetitionSizeTolerance);
                string key = SpaceKey(component.OwnerScope, component.OwnerBlockName)
                    + "|" + signature;
                List<EngineeringTopologyComponentRecord> values;
                if (!groups.TryGetValue(key, out values))
                {
                    values = new List<EngineeringTopologyComponentRecord>();
                    groups[key] = values;
                }
                values.Add(component);
            }
            var result = new List<EngineeringRepeatedPatternRecord>();
            foreach (List<EngineeringTopologyComponentRecord> values in groups.Values)
            {
                if (values.Count < 2) { continue; }
                values.Sort(delegate(
                    EngineeringTopologyComponentRecord left,
                    EngineeringTopologyComponentRecord right)
                {
                    int x = left.CenterX.CompareTo(right.CenterX);
                    return x != 0 ? x : left.CenterY.CompareTo(right.CenterY);
                });
                EngineeringTopologyComponentRecord first = values[0];
                result.Add(new EngineeringRepeatedPatternRecord(
                    "engineering-repeated-pattern-"
                        + (result.Count + 1).ToString(CultureInfo.InvariantCulture),
                    first.OwnerScope,
                    first.OwnerBlockName,
                    first.Role,
                    ComponentSignature(first, config.RepetitionSizeTolerance),
                    values));
            }
            result.Sort(delegate(
                EngineeringRepeatedPatternRecord left,
                EngineeringRepeatedPatternRecord right)
            {
                int count = right.InstanceCount.CompareTo(left.InstanceCount);
                return count != 0 ? count : string.CompareOrdinal(left.Id, right.Id);
            });
            return result;
        }

        static List<EngineeringSymmetryEvaluationRecord> EvaluateSymmetry(
            IList<EngineeringStrokeRecord> strokes,
            IList<EngineeringTopologyComponentRecord> components,
            IList<EngineeringReferenceAxisObservation> axes,
            EngineeringLineSemanticConfig config)
        {
            var result = new List<EngineeringSymmetryEvaluationRecord>();
            if (axes == null) { return result; }
            foreach (EngineeringReferenceAxisObservation axis in axes)
            {
                if (axis == null) { continue; }
                double dx = axis.EndX - axis.StartX;
                double dy = axis.EndY - axis.StartY;
                double axisLength = Math.Sqrt(dx * dx + dy * dy);
                if (axisLength <= config.GeometryTolerance) { continue; }
                double ux = dx / axisLength;
                double uy = dy / axisLength;
                double nx = -uy;
                double ny = ux;
                List<ShiftCandidate> shifts = ShiftCandidates(
                    axis,
                    components,
                    ux,
                    uy,
                    nx,
                    ny,
                    axisLength,
                    config);
                List<EngineeringStrokeRecord> context = SymmetryContext(
                    strokes,
                    axis,
                    shifts,
                    ux,
                    uy,
                    nx,
                    ny,
                    axisLength,
                    config);
                SymmetryCandidateResult named = null;
                SymmetryCandidateResult best = null;
                foreach (ShiftCandidate shift in shifts)
                {
                    SymmetryCandidateResult candidate = EvaluateShift(
                        context,
                        axis,
                        shift,
                        config);
                    if (Math.Abs(shift.ShiftX) <= 0.000001
                        && Math.Abs(shift.ShiftY) <= 0.000001)
                    {
                        named = candidate;
                    }
                    if (best == null
                        || candidate.Coverage > best.Coverage + 0.0000001
                        || Math.Abs(candidate.Coverage - best.Coverage) <= 0.0000001
                            && candidate.RmsResidual < best.RmsResidual)
                    {
                        best = candidate;
                    }
                }
                if (named == null)
                {
                    named = new SymmetryCandidateResult
                    {
                        Shift = new ShiftCandidate(),
                        FeatureCount = context.Count,
                        Coverage = 0,
                        RmsResidual = double.PositiveInfinity,
                        MaxResidual = double.PositiveInfinity
                    };
                }
                if (best == null) { best = named; }
                double normalOffset = best.Shift.ShiftX * nx + best.Shift.ShiftY * ny;
                string status;
                if (best.FeatureCount < config.SymmetryMinimumFeatureCount)
                {
                    status = "insufficient_context";
                }
                else if (best.Coverage >= config.SymmetryCoverageThreshold)
                {
                    status = Math.Abs(normalOffset) <= config.SymmetryMatchTolerance
                        ? "symmetric_about_named_axis"
                        : "symmetric_about_parallel_offset_axis";
                }
                else
                {
                    status = "not_symmetric_in_evaluated_context";
                }
                result.Add(new EngineeringSymmetryEvaluationRecord(
                    "engineering-symmetry-evaluation-"
                        + (result.Count + 1).ToString(CultureInfo.InvariantCulture),
                    axis,
                    status,
                    best.FeatureCount,
                    best.MatchedCount,
                    named.Coverage,
                    best.Coverage,
                    best.RmsResidual,
                    best.MaxResidual,
                    best.Shift.ShiftX,
                    best.Shift.ShiftY,
                    normalOffset,
                    best.Shift.Sources,
                    best.PairSamples));
            }
            return result;
        }

        static List<EngineeringStrokeRecord> SymmetryContext(
            IList<EngineeringStrokeRecord> strokes,
            EngineeringReferenceAxisObservation axis,
            IList<ShiftCandidate> shifts,
            double ux,
            double uy,
            double nx,
            double ny,
            double axisLength,
            EngineeringLineSemanticConfig config)
        {
            var result = new List<EngineeringStrokeRecord>();
            double tangentMargin = axisLength * config.SymmetryContextTangentMarginFactor;
            double normalLimit = Math.Max(
                config.SymmetryMatchTolerance * 10.0,
                axisLength * config.SymmetryContextNormalSpanFactor);
            foreach (EngineeringStrokeRecord stroke in strokes)
            {
                if (!stroke.TopologyEligible
                    || stroke.PrimaryRole != "visible_contour"
                        && stroke.PrimaryRole != "hidden_contour"
                        && stroke.PrimaryRole != "double_chain_reference"
                        && stroke.PrimaryRole != "continuous_geometry_candidate"
                    || !string.Equals(stroke.OwnerScope, axis.OwnerScope, StringComparison.Ordinal)
                    || !string.Equals(
                        stroke.OwnerBlockName,
                        axis.OwnerBlockName,
                        StringComparison.Ordinal))
                {
                    continue;
                }
                double px = stroke.MidX - axis.StartX;
                double py = stroke.MidY - axis.StartY;
                double tangent = px * ux + py * uy;
                double normal = px * nx + py * ny;
                bool insideAnyCandidateContext = false;
                foreach (ShiftCandidate shift in shifts)
                {
                    double shiftTangent = shift.ShiftX * ux + shift.ShiftY * uy;
                    double shiftNormal = shift.ShiftX * nx + shift.ShiftY * ny;
                    if (tangent - shiftTangent >= -tangentMargin
                        && tangent - shiftTangent <= axisLength + tangentMargin
                        && Math.Abs(normal - shiftNormal) <= normalLimit)
                    {
                        insideAnyCandidateContext = true;
                        break;
                    }
                }
                if (insideAnyCandidateContext)
                {
                    result.Add(stroke);
                }
            }
            return result;
        }

        static List<ShiftCandidate> ShiftCandidates(
            EngineeringReferenceAxisObservation axis,
            IList<EngineeringTopologyComponentRecord> components,
            double ux,
            double uy,
            double nx,
            double ny,
            double axisLength,
            EngineeringLineSemanticConfig config)
        {
            var result = new List<ShiftCandidate>();
            foreach (EngineeringAxisShiftObservation source in axis.CandidateShifts)
            {
                AddShift(result, source.ShiftX, source.ShiftY, source.Sources);
            }
            double tangentMargin = axisLength * config.SymmetryContextTangentMarginFactor;
            var derived = new List<EngineeringTopologyComponentRecord>();
            foreach (EngineeringTopologyComponentRecord component in components)
            {
                if (!component.IsClosed
                    || component.Role != "visible_contour"
                        && component.Role != "continuous_geometry_candidate"
                    || !string.Equals(component.OwnerScope, axis.OwnerScope, StringComparison.Ordinal)
                    || !string.Equals(
                        component.OwnerBlockName,
                        axis.OwnerBlockName,
                        StringComparison.Ordinal))
                {
                    continue;
                }
                derived.Add(component);
            }
            derived.Sort(delegate(
                EngineeringTopologyComponentRecord left,
                EngineeringTopologyComponentRecord right)
            {
                double leftNormal = Math.Abs(
                    (left.CenterX - axis.StartX) * nx
                    + (left.CenterY - axis.StartY) * ny);
                double rightNormal = Math.Abs(
                    (right.CenterX - axis.StartX) * nx
                    + (right.CenterY - axis.StartY) * ny);
                int offset = leftNormal.CompareTo(rightNormal);
                return offset != 0 ? offset : string.CompareOrdinal(left.Id, right.Id);
            });
            int emitted = 0;
            foreach (EngineeringTopologyComponentRecord component in derived)
            {
                double px = component.CenterX - axis.StartX;
                double py = component.CenterY - axis.StartY;
                double tangent = px * ux + py * uy;
                double normal = px * nx + py * ny;
                if (tangent < -tangentMargin
                    || tangent > axisLength + tangentMargin
                    || Math.Abs(normal) > axisLength * config.SymmetryContextNormalSpanFactor)
                {
                    continue;
                }
                AddShift(
                    result,
                    nx * normal,
                    ny * normal,
                    new[] { "closed_continuous_component_bbox_center:" + component.Id });
                emitted++;
                if (config.MaxDerivedSymmetryShiftCandidates > 0
                    && emitted >= config.MaxDerivedSymmetryShiftCandidates)
                {
                    break;
                }
            }
            return result;
        }

        static void AddShift(
            IList<ShiftCandidate> values,
            double x,
            double y,
            IList<string> sources)
        {
            ShiftCandidate matched = null;
            foreach (ShiftCandidate value in values)
            {
                if (Distance(value.ShiftX, value.ShiftY, x, y) <= 0.000001)
                {
                    matched = value;
                    break;
                }
            }
            if (matched == null)
            {
                matched = new ShiftCandidate { ShiftX = x, ShiftY = y };
                values.Add(matched);
            }
            if (sources != null)
            {
                foreach (string source in sources)
                {
                    if (!string.IsNullOrEmpty(source) && !matched.Sources.Contains(source))
                    {
                        matched.Sources.Add(source);
                    }
                }
            }
        }

        static SymmetryCandidateResult EvaluateShift(
            IList<EngineeringStrokeRecord> features,
            EngineeringReferenceAxisObservation axis,
            ShiftCandidate shift,
            EngineeringLineSemanticConfig config)
        {
            var result = new SymmetryCandidateResult();
            result.Shift = shift;
            result.FeatureCount = features.Count;
            double sumSquares = 0;
            result.MaxResidual = 0;
            foreach (EngineeringStrokeRecord feature in features)
            {
                double bestResidual = double.PositiveInfinity;
                EngineeringStrokeRecord bestMatch = null;
                foreach (EngineeringStrokeRecord candidate in features)
                {
                    if (candidate.GeometryFamily != feature.GeometryFamily
                        || candidate.PrimaryRole != feature.PrimaryRole)
                    {
                        continue;
                    }
                    double residual = SymmetryResidual(
                        feature,
                        candidate,
                        axis.StartX + shift.ShiftX,
                        axis.StartY + shift.ShiftY,
                        axis.EndX + shift.ShiftX,
                        axis.EndY + shift.ShiftY);
                    if (residual < bestResidual)
                    {
                        bestResidual = residual;
                        bestMatch = candidate;
                    }
                }
                if (bestMatch != null && bestResidual <= config.SymmetryMatchTolerance)
                {
                    result.MatchedCount++;
                    sumSquares += bestResidual * bestResidual;
                    result.MaxResidual = Math.Max(result.MaxResidual, bestResidual);
                    if (result.PairSamples.Count < config.SymmetryPairSampleLimit)
                    {
                        result.PairSamples.Add(feature.Handle + "~" + bestMatch.Handle);
                    }
                }
            }
            result.Coverage = result.FeatureCount == 0
                ? 0
                : (double)result.MatchedCount / result.FeatureCount;
            result.RmsResidual = result.MatchedCount == 0
                ? double.PositiveInfinity
                : Math.Sqrt(sumSquares / result.MatchedCount);
            return result;
        }

        static double SymmetryResidual(
            EngineeringStrokeRecord source,
            EngineeringStrokeRecord candidate,
            double axisStartX,
            double axisStartY,
            double axisEndX,
            double axisEndY)
        {
            if (source.GeometryFamily == "circle")
            {
                double[] reflected = ReflectPoint(
                    source.CenterX,
                    source.CenterY,
                    axisStartX,
                    axisStartY,
                    axisEndX,
                    axisEndY);
                return Distance(
                    reflected[0],
                    reflected[1],
                    candidate.CenterX,
                    candidate.CenterY)
                    + Math.Abs(source.Radius - candidate.Radius);
            }
            if (!source.HasEndpoints || !candidate.HasEndpoints)
            {
                return double.PositiveInfinity;
            }
            double[] first = ReflectPoint(
                source.StartX,
                source.StartY,
                axisStartX,
                axisStartY,
                axisEndX,
                axisEndY);
            double[] second = ReflectPoint(
                source.EndX,
                source.EndY,
                axisStartX,
                axisStartY,
                axisEndX,
                axisEndY);
            double direct = Math.Max(
                Distance(first[0], first[1], candidate.StartX, candidate.StartY),
                Distance(second[0], second[1], candidate.EndX, candidate.EndY));
            double reversed = Math.Max(
                Distance(first[0], first[1], candidate.EndX, candidate.EndY),
                Distance(second[0], second[1], candidate.StartX, candidate.StartY));
            return Math.Min(direct, reversed)
                + Math.Abs(source.Length - candidate.Length) * 0.01;
        }

        static double[] ReflectPoint(
            double x,
            double y,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            double dx = endX - startX;
            double dy = endY - startY;
            double lengthSquared = dx * dx + dy * dy;
            if (lengthSquared <= 0) { return new[] { x, y }; }
            double t = ((x - startX) * dx + (y - startY) * dy) / lengthSquared;
            double projectionX = startX + t * dx;
            double projectionY = startY + t * dy;
            return new[] { 2.0 * projectionX - x, 2.0 * projectionY - y };
        }

        static string ComponentSignature(
            EngineeringTopologyComponentRecord component,
            double tolerance)
        {
            tolerance = tolerance <= 0 ? 0.1 : tolerance;
            return component.Role
                + ":s" + component.StrokeCount.ToString(CultureInfo.InvariantCulture)
                + ":n" + component.NodeIds.Count.ToString(CultureInfo.InvariantCulture)
                + ":o" + component.OpenEndCount.ToString(CultureInfo.InvariantCulture)
                + ":b" + component.BranchNodeCount.ToString(CultureInfo.InvariantCulture)
                + ":c" + (component.IsClosed ? "1" : "0")
                + ":w" + Math.Round(component.Width / tolerance).ToString(CultureInfo.InvariantCulture)
                + ":h" + Math.Round(component.Height / tolerance).ToString(CultureInfo.InvariantCulture);
        }

        static string ProfileKey(
            ResolvedEngineeringStyle style,
            EngineeringRoleAnalysis role)
        {
            return style.Layer + "|"
                + style.ColorName + "|"
                + (style.HasColorIndex
                    ? style.ColorIndex.ToString(CultureInfo.InvariantCulture)
                    : "") + "|"
                + (style.HasRgb
                    ? style.Red.ToString(CultureInfo.InvariantCulture) + ","
                        + style.Green.ToString(CultureInfo.InvariantCulture) + ","
                        + style.Blue.ToString(CultureInfo.InvariantCulture)
                    : "") + "|"
                + style.ColorResolutionStatus + "|"
                + style.Linetype + "|"
                + style.LinetypeFamily + "|"
                + style.LinetypeResolutionStatus + "|"
                + (style.HasLineweight
                    ? style.Lineweight.ToString(CultureInfo.InvariantCulture)
                    : "") + "|"
                + role.PrimaryRole + "|"
                + role.Status;
        }

        static string ColorKey(ResolvedEngineeringStyle style)
        {
            return style.ColorName + "|"
                + (style.HasColorIndex
                    ? style.ColorIndex.ToString(CultureInfo.InvariantCulture)
                    : "") + "|"
                + (style.HasRgb
                    ? style.Red.ToString(CultureInfo.InvariantCulture) + ","
                        + style.Green.ToString(CultureInfo.InvariantCulture) + ","
                        + style.Blue.ToString(CultureInfo.InvariantCulture)
                    : "") + "|"
                + style.ColorResolutionStatus;
        }

        static ISet<string> Set(IList<string> values)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (values != null)
            {
                foreach (string value in values)
                {
                    if (!string.IsNullOrEmpty(value)) { result.Add(value); }
                }
            }
            return result;
        }

        static bool IsAnnotationRuntime(EngineeringLineObservation observation)
        {
            string type = observation.ManagedType ?? "";
            string runtime = observation.RuntimeClass ?? "";
            return type.IndexOf("Dimension", StringComparison.Ordinal) >= 0
                || type == "Leader"
                || type == "MLeader"
                || runtime.IndexOf("TH_Dim", StringComparison.Ordinal) >= 0
                || runtime == "TH_XuHaoEntity"
                || runtime == "TH_ParaBasePntUA"
                || runtime == "TH_CVArrowLine";
        }

        static bool IsGeometryLikeName(string kind)
        {
            return !string.IsNullOrEmpty(kind)
                && kind != "text"
                && kind != "mtext"
                && kind != "block_reference"
                && kind != "dimension"
                && kind != "leader"
                && kind != "mleader"
                && kind != "professional"
                && kind != "table";
        }

        static bool Contains(string value, string marker)
        {
            return (value ?? "").IndexOf(marker, StringComparison.Ordinal) >= 0;
        }

        static void Increment(IDictionary<string, int> values, string key)
        {
            key = key ?? "";
            int count;
            values.TryGetValue(key, out count);
            values[key] = count + 1;
        }

        static bool SameSpace(
            EngineeringTopologyComponentRecord first,
            EngineeringTopologyComponentRecord second)
        {
            return string.Equals(first.OwnerScope, second.OwnerScope, StringComparison.Ordinal)
                && string.Equals(
                    first.OwnerBlockName,
                    second.OwnerBlockName,
                    StringComparison.Ordinal);
        }

        static string SpaceKey(string ownerScope, string ownerBlockName)
        {
            return (ownerScope ?? "") + ":" + (ownerBlockName ?? "");
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx;
            double dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }
    }

    internal static class EngineeringLineMaps
    {
        internal static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < pairs.Length; index += 2)
            {
                result[(string)pairs[index]] = pairs[index + 1];
            }
            return result;
        }
    }
}
