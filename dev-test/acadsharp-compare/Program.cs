using System.Collections;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ACadSharp;
using ACadSharp.Classes;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Tables;

var options = Options.Parse(args);
Directory.CreateDirectory(options.OutputRoot);

var drawings = ResolveDrawings(options.DrawingInput).ToArray();
if (drawings.Length == 0)
{
    Console.Error.WriteLine($"No DWG files found under {options.DrawingInput}");
    return 2;
}

Console.WriteLine($"ACadSharp {typeof(CadDocument).Assembly.GetName().Version} | drawings={drawings.Length}");
var aggregate = new List<DrawingRunResult>();
var failures = 0;

foreach (var drawing in drawings)
{
    var drawingId = Path.GetFileNameWithoutExtension(drawing);
    var outputDirectory = Path.Combine(options.OutputRoot, drawingId);
    Directory.CreateDirectory(outputDirectory);
    Console.WriteLine($"[{drawingId}] reading {new FileInfo(drawing).Length:N0} bytes");

    try
    {
        var extraction = DrawingExtractor.Extract(drawing);
        JsonFiles.WriteJsonLines(Path.Combine(outputDirectory, "entities.jsonl"), extraction.Entities);
        JsonFiles.WriteJsonLines(Path.Combine(outputDirectory, "dictionary-entries.jsonl"), extraction.DictionaryEntries);
        JsonFiles.WriteJsonLines(Path.Combine(outputDirectory, "notifications.jsonl"), extraction.Notifications);
        JsonFiles.Write(Path.Combine(outputDirectory, "acadsharp-report.json"), extraction.Report);

        var thcadDirectory = Path.Combine(options.ThcadRoot, drawingId);
        var comparison = ThcadComparer.Compare(extraction, thcadDirectory);
        JsonFiles.Write(Path.Combine(outputDirectory, "comparison.json"), comparison);

        aggregate.Add(new DrawingRunResult(drawingId, extraction.Report, comparison, null));
        Console.WriteLine(
            $"[{drawingId}] ACadSharp={extraction.Report.EntityCount:N0} THCAD={comparison.ThcadEntityCount:N0} " +
            $"shared={comparison.SharedHandleCount:N0} onlyACadSharp={comparison.OnlyAcadSharpCount:N0} " +
            $"onlyTHCAD={comparison.OnlyThcadCount:N0} proxies={extraction.Report.ProxyEntityCount:N0} " +
            $"proxyGraphics={extraction.Report.ProxyGraphicCount:N0} read={extraction.Report.ElapsedMs:N1}ms");
    }
    catch (Exception exception)
    {
        failures++;
        var failure = new FailureInfo(exception.GetType().FullName ?? exception.GetType().Name, exception.Message, exception.StackTrace);
        JsonFiles.Write(Path.Combine(outputDirectory, "failure.json"), failure);
        aggregate.Add(new DrawingRunResult(drawingId, null, null, failure));
        Console.Error.WriteLine($"[{drawingId}] FAILED {exception.GetType().Name}: {exception.Message}");
    }
}

var aggregateReport = AggregateBuilder.Build(aggregate, options);
JsonFiles.Write(Path.Combine(options.OutputRoot, "aggregate.json"), aggregateReport);
Console.WriteLine($"Wrote {Path.Combine(options.OutputRoot, "aggregate.json")}");
return failures == 0 ? 0 : 1;

static IEnumerable<string> ResolveDrawings(string input)
{
    if (File.Exists(input))
    {
        yield return Path.GetFullPath(input);
        yield break;
    }

    if (!Directory.Exists(input))
        yield break;

    foreach (var path in Directory.EnumerateFiles(input, "*", SearchOption.TopDirectoryOnly)
                 .Where(path => string.Equals(Path.GetExtension(path), ".dwg", StringComparison.OrdinalIgnoreCase))
                 .OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        yield return Path.GetFullPath(path);
}

sealed record Options(string DrawingInput, string ThcadRoot, string OutputRoot)
{
    public static Options Parse(string[] arguments)
    {
        var drawingInput = arguments.Length > 0
            ? arguments[0]
            : Path.Combine("client-data", "transformer-design-drawings");
        var thcadRoot = arguments.Length > 1
            ? arguments[1]
            : Path.Combine("dev-test", "visualstudionetframework", "out-thcad");
        var outputRoot = arguments.Length > 2
            ? arguments[2]
            : Path.Combine("dev-test", "acadsharp-compare", "out");
        return new Options(
            Path.GetFullPath(drawingInput),
            Path.GetFullPath(thcadRoot),
            Path.GetFullPath(outputRoot));
    }
}

static class DrawingExtractor
{
    public static DrawingExtraction Extract(string drawingPath)
    {
        var notifications = new List<ReaderNotification>();
        var stopwatch = Stopwatch.StartNew();
        using var reader = new DwgReader(drawingPath);
        reader.Configuration.Failsafe = false;
        reader.Configuration.KeepUnknownEntities = true;
        reader.Configuration.KeepUnknownNonGraphicalObjects = true;
        ObjectIntrospection.TrySetProperty(reader.Configuration, "IgnoreProxyGraphics", false);
        reader.OnNotification += (_, notification) => notifications.Add(new ReaderNotification(
            notification.NotificationType.ToString(),
            notification.Message));

        var document = reader.Read();
        stopwatch.Stop();

        var entities = new List<EntitySnapshot>();
        foreach (var block in document.BlockRecords.OrderBy(block => block.Name, StringComparer.Ordinal))
        {
            var ownerScope = ScopeFor(block.Name);
            foreach (var entity in block.Entities)
                entities.Add(SnapshotEntity(entity, block, ownerScope));
        }

        var dictionaryEntries = ObjectIntrospection.FlattenDictionary(document.RootDictionary);
        var dxfClasses = document.Classes
            .OrderBy(item => item.ClassNumber)
            .Select(SnapshotDxfClass)
            .Where(item => item is not null)
            .Cast<DxfClassSnapshot>()
            .ToArray();
        var customClasses = dxfClasses
            .Where(item => !item.ApplicationName.Contains("ObjectDBX", StringComparison.OrdinalIgnoreCase)
                           || item.DxfName.StartsWith("TH_", StringComparison.OrdinalIgnoreCase)
                           || item.DxfName.StartsWith("PC_", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        var proxyEntities = entities.Where(entity => entity.Proxy is not null).ToArray();
        var report = new AcadSharpReport(
            SourcePath: drawingPath,
            SourceSizeBytes: new FileInfo(drawingPath).Length,
            SourceSha256: Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(drawingPath))).ToLowerInvariant(),
            LibraryVersion: typeof(CadDocument).Assembly.GetName().Version?.ToString() ?? "unknown",
            ElapsedMs: stopwatch.Elapsed.TotalMilliseconds,
            ReaderConfiguration: new ReaderConfigurationSnapshot(
                false,
                true,
                true,
                false,
                ObjectIntrospection.HasProperty(reader.Configuration, "IgnoreProxyGraphics")),
            EntityCount: entities.Count,
            ModelSpaceEntityCount: entities.Count(entity => entity.OwnerScope == "model_space"),
            PaperSpaceEntityCount: entities.Count(entity => entity.OwnerScope == "paper_space"),
            BlockDefinitionEntityCount: entities.Count(entity => entity.OwnerScope == "block_definition"),
            ZeroHandleEntityCount: entities.Count(entity => entity.Handle == "0"),
            DuplicateHandleCount: entities.GroupBy(entity => entity.Handle).Count(group => group.Count() > 1),
            ProxyEntityCount: proxyEntities.Length,
            UnknownEntityCount: entities.Count(entity => entity.AcadSharpType.EndsWith(".UnknownEntity", StringComparison.Ordinal)),
            ProxyEntityWithGraphicsCount: proxyEntities.Count(entity => entity.Proxy!.Graphics.Count > 0),
            ProxyGraphicCount: proxyEntities.Sum(entity => entity.Proxy!.Graphics.Count),
            ProxyGraphicTypeCounts: Counts(proxyEntities.SelectMany(entity => entity.Proxy!.Graphics).Select(item => item.Type)),
            EntityTypeCounts: Counts(entities.Select(entity => entity.AcadSharpType)),
            ObjectNameCounts: Counts(entities.Select(entity => entity.ObjectName)),
            ProxyClassCounts: Counts(proxyEntities.Select(entity => entity.Proxy!.DxfClass?.CppClassName ?? "<unmapped>")),
            BlockRecordCount: document.BlockRecords.Count,
            TableCounts: new SortedDictionary<string, int>(StringComparer.Ordinal)
            {
                ["app_ids"] = document.AppIds.Count,
                ["blocks"] = document.BlockRecords.Count,
                ["dimension_styles"] = document.DimensionStyles.Count,
                ["layers"] = document.Layers.Count,
                ["layouts"] = document.Layouts.Count(),
                ["line_types"] = document.LineTypes.Count,
                ["text_styles"] = document.TextStyles.Count,
                ["ucs"] = document.UCSs.Count,
                ["viewports"] = document.VPorts.Count,
                ["views"] = document.Views.Count,
            },
            DictionaryEntryCount: dictionaryEntries.Count,
            RootDictionaryKeys: ObjectIntrospection.DictionaryKeys(document.RootDictionary),
            DxfClasses: dxfClasses,
            CustomDxfClasses: customClasses,
            NotificationCount: notifications.Count,
            NotificationTypeCounts: Counts(notifications.Select(item => item.Type)));

        return new DrawingExtraction(entities, dictionaryEntries, notifications, report);
    }

    private static EntitySnapshot SnapshotEntity(Entity entity, BlockRecord block, string ownerScope)
    {
        object? boundingBox = null;
        string? boundingBoxError = null;
        BoundingBoxFacts? boundingBoxFacts = null;
        try
        {
            var rawBoundingBox = entity.GetBoundingBox();
            boundingBox = ObjectIntrospection.SnapshotValue(rawBoundingBox, 2);
            boundingBoxFacts = ObjectIntrospection.ReadBoundingBoxFacts(rawBoundingBox);
            if (ObjectIntrospection.ContainsNonFinite(boundingBox) || boundingBoxFacts?.IsFinite == false)
                boundingBoxError = "non-finite bounding box";
        }
        catch (Exception exception)
        {
            boundingBoxError = $"{exception.GetType().Name}: {exception.Message}";
        }

        var propertyErrors = new List<string>();
        var properties = ObjectIntrospection.EntityProperties(entity, propertyErrors);
        ProxySnapshot? proxy = null;
        if (entity is ProxyEntity proxyEntity)
        {
            var graphics = ObjectIntrospection.ProxyGraphics(proxyEntity)
                .Select(geometry => new ProxyGraphicSnapshot(
                    geometry.GetType().FullName ?? geometry.GetType().Name,
                    ObjectIntrospection.SnapshotValue(geometry, 4)))
                .ToArray();
            proxy = new ProxySnapshot(
                proxyEntity.ClassId,
                proxyEntity.DrawingFormat,
                proxyEntity.Version.ToString(),
                proxyEntity.OriginalDataFormatDxf,
                SnapshotDxfClass(proxyEntity.DxfClass),
                graphics);
        }

        return new EntitySnapshot(
            Handle: NormalizeHandle(entity.Handle.ToString("X", CultureInfo.InvariantCulture)),
            AcadSharpType: entity.GetType().FullName ?? entity.GetType().Name,
            ObjectName: entity.ObjectName,
            ObjectType: entity.ObjectType.ToString(),
            SubclassMarker: entity.SubclassMarker,
            OwnerScope: ownerScope,
            OwnerBlockName: block.Name,
            OwnerHandle: NormalizeHandle(block.Handle.ToString("X", CultureInfo.InvariantCulture)),
            Layer: entity.Layer?.Name,
            LineType: entity.LineType?.Name,
            LineWeight: entity.LineWeight.ToString(),
            Visible: !entity.IsInvisible,
            Color: ObjectIntrospection.SnapshotValue(entity.Color, 2),
            Transparency: ObjectIntrospection.SnapshotValue(entity.Transparency, 2),
            BoundingBox: boundingBox,
            BoundingBoxFacts: boundingBoxFacts,
            BoundingBoxError: boundingBoxError,
            XDataApplications: ObjectIntrospection.DictionaryKeys(entity.ExtendedData),
            XData: ObjectIntrospection.SnapshotValue(entity.ExtendedData, 4),
            HasXDictionary: entity.XDictionary is not null,
            XDictionaryKeys: ObjectIntrospection.DictionaryKeys(entity.XDictionary),
            Properties: properties,
            PropertyErrors: propertyErrors,
            ComparableFacts: ObjectIntrospection.ComparableFacts(entity),
            Proxy: proxy);
    }

    private static string ScopeFor(string blockName)
    {
        if (blockName.Equals(BlockRecord.ModelSpaceName, StringComparison.OrdinalIgnoreCase))
            return "model_space";
        if (blockName.StartsWith("*Paper_Space", StringComparison.OrdinalIgnoreCase))
            return "paper_space";
        return "block_definition";
    }

    private static DxfClassSnapshot? SnapshotDxfClass(DxfClass? item)
    {
        if (item is null)
            return null;
        return new DxfClassSnapshot(
            item.ClassNumber,
            item.DxfName,
            item.CppClassName,
            item.ApplicationName,
            item.IsAnEntity,
            item.InstanceCount,
            item.WasZombie,
            item.ProxyFlags.ToString());
    }

    private static SortedDictionary<string, int> Counts(IEnumerable<string?> values) =>
        new(values.GroupBy(value => value ?? "<null>", StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal), StringComparer.Ordinal);

    private static string NormalizeHandle(string value) => ThcadComparer.NormalizeHandle(value);
}

static class ObjectIntrospection
{
    private static readonly HashSet<string> EntityCommonProperties = new(StringComparer.Ordinal)
    {
        "BookColor", "Color", "Document", "ExtendedData", "Handle", "HasDynamicSubclass", "IsInvisible",
        "Layer", "LineType", "LineTypeScale", "LineWeight", "Material", "ObjectName", "ObjectType", "Owner",
        "ProxyGeometries", "Reactors", "SubclassMarker", "Transparency", "XDictionary",
    };

    public static SortedDictionary<string, object?> EntityProperties(Entity entity, List<string> errors)
    {
        var result = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        foreach (var property in entity.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance)
                     .Where(property => property.GetIndexParameters().Length == 0)
                     .Where(property => !EntityCommonProperties.Contains(property.Name))
                     .OrderBy(property => property.Name, StringComparer.Ordinal))
        {
            try
            {
                var value = property.GetValue(entity);
                if (value is not null)
                    result[property.Name] = SnapshotValue(value, 4);
            }
            catch (Exception exception)
            {
                errors.Add($"{property.Name}: {exception.GetBaseException().GetType().Name}: {exception.GetBaseException().Message}");
            }
        }
        return result;
    }

    public static ComparableEntityFacts ComparableFacts(Entity entity)
    {
        var center = VectorProperty(entity, "Center");
        if (center is not null && (entity is Circle || entity is Arc))
            center = OcsToWcs(center, VectorProperty(entity, "Normal"));
        var position = VectorProperty(entity, "InsertPoint") ?? VectorProperty(entity, "Location");
        if (position is not null && entity is Insert)
            position = OcsToWcs(position, VectorProperty(entity, "Normal"));
        return new ComparableEntityFacts(
            Start: VectorProperty(entity, "StartPoint"),
            End: VectorProperty(entity, "EndPoint"),
            Center: center,
            Position: position,
            Radius: NumberProperty(entity, "Radius"),
            StartAngle: NumberProperty(entity, "StartAngle"),
            EndAngle: NumberProperty(entity, "EndAngle"),
            Measurement: NumberProperty(entity, "Measurement") ?? NumberProperty(entity, "ActualMeasurement"),
            PlanarMeasurement: PlanarAlignedMeasurement(entity),
            Text: StringProperty(entity, "PlainText") ?? StringProperty(entity, "Value"),
            RawText: StringProperty(entity, "Value") ?? StringProperty(entity, "Text"));
    }

    private static double? PlanarAlignedMeasurement(Entity entity)
    {
        if (entity is not DimensionAligned)
            return null;
        var first = VectorProperty(entity, "FirstPoint");
        var second = VectorProperty(entity, "SecondPoint");
        var normal = VectorProperty(entity, "Normal");
        if (first is null || second is null || normal is null)
            return null;
        var n = Normalize(normal);
        var delta = new[] { second[0] - first[0], second[1] - first[1], second[2] - first[2] };
        var normalDistance = delta[0] * n[0] + delta[1] * n[1] + delta[2] * n[2];
        var planarSquared = delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2] - normalDistance * normalDistance;
        return Math.Sqrt(Math.Max(0.0, planarSquared));
    }

    private static double[] OcsToWcs(double[] point, double[]? normal)
    {
        if (normal is null)
            return point;
        var n = Normalize(normal);
        if (Math.Abs(n[0]) <= 1e-12 && Math.Abs(n[1]) <= 1e-12 && Math.Abs(n[2] - 1.0) <= 1e-12)
            return point;
        var reference = Math.Abs(n[0]) < 1.0 / 64.0 && Math.Abs(n[1]) < 1.0 / 64.0
            ? new[] { 0.0, 1.0, 0.0 }
            : new[] { 0.0, 0.0, 1.0 };
        var xAxis = Normalize(Cross(reference, n));
        var yAxis = Cross(n, xAxis);
        return
        [
            point[0] * xAxis[0] + point[1] * yAxis[0] + point[2] * n[0],
            point[0] * xAxis[1] + point[1] * yAxis[1] + point[2] * n[1],
            point[0] * xAxis[2] + point[1] * yAxis[2] + point[2] * n[2],
        ];
    }

    private static double[] Cross(double[] left, double[] right) =>
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ];

    private static double[] Normalize(double[] value)
    {
        var length = Math.Sqrt(value[0] * value[0] + value[1] * value[1] + value[2] * value[2]);
        return length <= 1e-20 ? [0.0, 0.0, 1.0] : [value[0] / length, value[1] / length, value[2] / length];
    }

    public static BoundingBoxFacts? ReadBoundingBoxFacts(object value)
    {
        var min = VectorProperty(value, "Min");
        var max = VectorProperty(value, "Max");
        if (min is null || max is null)
            return null;
        var finite = min.Concat(max).All(double.IsFinite);
        if (!finite)
            return null;
        var degenerate = finite && Enumerable.Range(0, 3).All(index => Math.Abs(max[index] - min[index]) <= 1e-10);
        return new BoundingBoxFacts(min, max, finite, degenerate);
    }

    public static object? SnapshotValue(object? value, int depth) =>
        SnapshotValue(value, depth, new HashSet<object>(ReferenceEqualityComparer.Instance));

    public static bool ContainsNonFinite(object? value)
    {
        if (value is string text)
            return text is "NaN" or "Infinity" or "-Infinity";
        if (value is IDictionary dictionary)
            return dictionary.Values.Cast<object?>().Any(ContainsNonFinite);
        if (value is IEnumerable enumerable)
            return enumerable.Cast<object?>().Any(ContainsNonFinite);
        return false;
    }

    public static void TrySetProperty(object target, string propertyName, object value)
    {
        var property = target.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
        if (property?.CanWrite == true)
            property.SetValue(target, value);
    }

    public static bool HasProperty(object target, string propertyName) =>
        target.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance) is not null;

    public static IEnumerable<object> ProxyGraphics(Entity entity)
    {
        var property = entity.GetType().GetProperty("ProxyGeometries", BindingFlags.Public | BindingFlags.Instance)
                       ?? typeof(Entity).GetProperty("ProxyGeometries", BindingFlags.Public | BindingFlags.Instance);
        if (property?.GetValue(entity) is not IEnumerable enumerable)
            yield break;
        foreach (var item in enumerable)
            if (item is not null)
                yield return item;
    }

    public static List<string> DictionaryKeys(object? dictionary)
    {
        var keys = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var pair in KeyValuePairs(dictionary))
        {
            var key = ReferenceName(pair.Key) ?? pair.Key?.ToString();
            if (!string.IsNullOrWhiteSpace(key))
                keys.Add(key);
        }
        return keys.ToList();
    }

    public static List<DictionaryEntrySnapshot> FlattenDictionary(object? root)
    {
        var result = new List<DictionaryEntrySnapshot>();
        FlattenDictionary(root, string.Empty, result, new HashSet<object>(ReferenceEqualityComparer.Instance), 0);
        return result;
    }

    private static void FlattenDictionary(
        object? dictionary,
        string parentPath,
        List<DictionaryEntrySnapshot> result,
        HashSet<object> visited,
        int depth)
    {
        if (dictionary is null || depth > 12 || !visited.Add(dictionary))
            return;

        foreach (var pair in KeyValuePairs(dictionary))
        {
            var key = ReferenceName(pair.Key) ?? pair.Key?.ToString() ?? "<null>";
            var path = string.IsNullOrEmpty(parentPath) ? key : $"{parentPath}/{key}";
            var value = pair.Value;
            result.Add(new DictionaryEntrySnapshot(
                path,
                key,
                value?.GetType().FullName,
                HandleOf(value),
                PropertyString(value, "ObjectName"),
                DxfClassOf(value)));

            if (value is not null && value.GetType().Name.Contains("Dictionary", StringComparison.OrdinalIgnoreCase))
                FlattenDictionary(value, path, result, visited, depth + 1);
        }
    }

    private static object? SnapshotValue(object? value, int depth, HashSet<object> visited)
    {
        if (value is null)
            return null;
        if (value is string or bool or char or DateTime or DateTimeOffset or Guid)
            return value;
        if (value is byte[] bytes)
            return new SortedDictionary<string, object?> { ["byte_count"] = bytes.Length };

        var type = value.GetType();
        if (type.IsEnum)
            return value.ToString();
        if (IsNumber(type))
            return FiniteNumber(value);
        if (value is Type reflectedType)
            return reflectedType.FullName;

        if (value is CadObject cadObject)
            return ReferenceSnapshot(cadObject);
        if (depth <= 0)
            return value.ToString();
        if (!type.IsValueType && !visited.Add(value))
            return "<cycle>";

        try
        {
            if (value is IEnumerable enumerable)
            {
                var items = new List<object?>();
                var total = 0;
                foreach (var item in enumerable)
                {
                    total++;
                    if (items.Count < 512)
                        items.Add(SnapshotValue(item, depth - 1, visited));
                }
                if (total <= 512)
                    return items;
                return new SortedDictionary<string, object?>
                {
                    ["count"] = total,
                    ["items"] = items,
                    ["truncated"] = true,
                };
            }

            var result = new SortedDictionary<string, object?>(StringComparer.Ordinal);
            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                         .Where(property => property.GetIndexParameters().Length == 0 && property.Name != "Document")
                         .OrderBy(property => property.Name, StringComparer.Ordinal))
            {
                try
                {
                    var propertyValue = property.GetValue(value);
                    if (propertyValue is not null)
                        result[property.Name] = SnapshotValue(propertyValue, depth - 1, visited);
                }
                catch (Exception exception)
                {
                    result[$"{property.Name}__error"] = exception.GetBaseException().GetType().Name;
                }
            }
            foreach (var field in type.GetFields(BindingFlags.Public | BindingFlags.Instance)
                         .OrderBy(field => field.Name, StringComparer.Ordinal))
            {
                if (!result.ContainsKey(field.Name))
                    result[field.Name] = SnapshotValue(field.GetValue(value), depth - 1, visited);
            }
            return result.Count == 0 ? value.ToString() : result;
        }
        finally
        {
            if (!type.IsValueType)
                visited.Remove(value);
        }
    }

    private static IEnumerable<(object? Key, object? Value)> KeyValuePairs(object? dictionary)
    {
        if (dictionary is not IEnumerable enumerable)
            yield break;
        foreach (var item in enumerable)
        {
            if (item is null)
                continue;
            var type = item.GetType();
            var key = type.GetProperty("Key")?.GetValue(item);
            var value = type.GetProperty("Value")?.GetValue(item);
            if (key is not null || value is not null)
                yield return (key, value);
            else if (item is CadObject)
                yield return (ReferenceName(item) ?? HandleOf(item), item);
        }
    }

    private static SortedDictionary<string, object?> ReferenceSnapshot(CadObject value)
    {
        var result = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["handle"] = ThcadComparer.NormalizeHandle(value.Handle.ToString("X", CultureInfo.InvariantCulture)),
            ["object_name"] = value.ObjectName,
            ["type"] = value.GetType().FullName,
        };
        var name = ReferenceName(value);
        if (!string.IsNullOrWhiteSpace(name))
            result["name"] = name;
        return result;
    }

    private static string? ReferenceName(object? value) => PropertyString(value, "Name");

    private static string? PropertyString(object? value, string propertyName)
    {
        if (value is null)
            return null;
        try
        {
            return value.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value)?.ToString();
        }
        catch
        {
            return null;
        }
    }

    private static string? HandleOf(object? value)
    {
        if (value is null)
            return null;
        try
        {
            var handle = value.GetType().GetProperty("Handle", BindingFlags.Public | BindingFlags.Instance)?.GetValue(value);
            if (handle is ulong number)
                return ThcadComparer.NormalizeHandle(number.ToString("X", CultureInfo.InvariantCulture));
            return handle?.ToString();
        }
        catch
        {
            return null;
        }
    }

    private static DxfClassSnapshot? DxfClassOf(object? value)
    {
        if (value is null)
            return null;
        try
        {
            var dxfClass = value.GetType().GetProperty("DxfClass", BindingFlags.Public | BindingFlags.Instance)?.GetValue(value) as DxfClass;
            return dxfClass is null ? null : new DxfClassSnapshot(
                dxfClass.ClassNumber,
                dxfClass.DxfName,
                dxfClass.CppClassName,
                dxfClass.ApplicationName,
                dxfClass.IsAnEntity,
                dxfClass.InstanceCount,
                dxfClass.WasZombie,
                dxfClass.ProxyFlags.ToString());
        }
        catch
        {
            return null;
        }
    }

    private static double[]? VectorProperty(object value, string propertyName)
    {
        try
        {
            var vector = value.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value);
            if (vector is null)
                return null;
            var x = NumericMember(vector, "X");
            var y = NumericMember(vector, "Y");
            var z = NumericMember(vector, "Z") ?? 0.0;
            return x.HasValue && y.HasValue && double.IsFinite(x.Value) && double.IsFinite(y.Value) && double.IsFinite(z)
                ? [x.Value, y.Value, z]
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static double? NumberProperty(object value, string propertyName)
    {
        try
        {
            var raw = value.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value);
            if (raw is null)
                return null;
            var number = Convert.ToDouble(raw, CultureInfo.InvariantCulture);
            return double.IsFinite(number) ? number : null;
        }
        catch
        {
            return null;
        }
    }

    private static string? StringProperty(object value, string propertyName)
    {
        try
        {
            return value.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value) as string;
        }
        catch
        {
            return null;
        }
    }

    private static double? NumericMember(object value, string name)
    {
        try
        {
            var raw = value.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value)
                      ?? value.GetType().GetField(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(value);
            return raw is null ? null : Convert.ToDouble(raw, CultureInfo.InvariantCulture);
        }
        catch
        {
            return null;
        }
    }

    private static bool IsNumber(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        return type == typeof(byte) || type == typeof(sbyte) || type == typeof(short) || type == typeof(ushort)
               || type == typeof(int) || type == typeof(uint) || type == typeof(long) || type == typeof(ulong)
               || type == typeof(float) || type == typeof(double) || type == typeof(decimal);
    }

    private static object FiniteNumber(object value)
    {
        if (value is double number && (double.IsNaN(number) || double.IsInfinity(number)))
            return number.ToString(CultureInfo.InvariantCulture);
        if (value is float single && (float.IsNaN(single) || float.IsInfinity(single)))
            return single.ToString(CultureInfo.InvariantCulture);
        return value;
    }
}

static class ThcadComparer
{
    public static ComparisonReport Compare(DrawingExtraction acadSharp, string thcadDirectory)
    {
        var entitiesPath = Path.Combine(thcadDirectory, "entities.jsonl");
        if (!File.Exists(entitiesPath))
            return ComparisonReport.Missing(entitiesPath, acadSharp.Report.EntityCount);

        var thcad = LoadThcadEntities(entitiesPath);
        var acadByHandle = acadSharp.Entities
            .Where(entity => entity.Handle != "0")
            .GroupBy(entity => entity.Handle, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var thcadByHandle = thcad
            .Where(entity => entity.Handle != "0")
            .GroupBy(entity => entity.Handle, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var shared = acadByHandle.Keys.Intersect(thcadByHandle.Keys, StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.Ordinal).ToArray();
        var onlyAcad = acadByHandle.Keys.Except(thcadByHandle.Keys, StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.Ordinal).ToArray();
        var onlyThcad = thcadByHandle.Keys.Except(acadByHandle.Keys, StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.Ordinal).ToArray();

        var crosswalk = shared
            .Select(handle => new
            {
                Thcad = thcadByHandle[handle].RuntimeClass,
                Acad = acadByHandle[handle].AcadSharpType,
                ProxyClass = acadByHandle[handle].Proxy?.DxfClass?.CppClassName,
            })
            .GroupBy(item => (item.Thcad, item.Acad, item.ProxyClass))
            .Select(group => new TypeCrosswalk(group.Key.Thcad, group.Key.Acad, group.Key.ProxyClass, group.Count()))
            .OrderByDescending(item => item.Count)
            .ThenBy(item => item.ThcadRuntimeClass, StringComparer.Ordinal)
            .ToArray();

        var parity = GeometryParity.Build(shared.Select(handle => (acadByHandle[handle], thcadByHandle[handle])));
        var boundingBoxParity = BoundingBoxParity.Build(shared.Select(handle => (acadByHandle[handle], thcadByHandle[handle])));
        var thcadProfessional = thcad.Where(entity => entity.RuntimeClass.StartsWith("TH_", StringComparison.OrdinalIgnoreCase)).ToArray();
        var professionalMappings = thcadProfessional.Select(entity =>
        {
            acadByHandle.TryGetValue(entity.Handle, out var acad);
            return new ProfessionalMapping(
                entity.Handle,
                entity.RuntimeClass,
                entity.DxfName,
                acad?.AcadSharpType,
                acad?.Proxy?.DxfClass?.CppClassName,
                acad?.Proxy?.DxfClass?.DxfName,
                acad?.Proxy?.Graphics.Count ?? 0,
                acad?.Proxy?.Graphics.Select(item => item.Type).Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray() ?? []);
        }).ToArray();

        return new ComparisonReport(
            ThcadAvailable: true,
            ThcadEntitiesPath: entitiesPath,
            AcadSharpEntityCount: acadSharp.Report.EntityCount,
            ThcadEntityCount: thcad.Count,
            SharedHandleCount: shared.Length,
            OnlyAcadSharpCount: onlyAcad.Length,
            OnlyThcadCount: onlyThcad.Length,
            OnlyAcadSharp: onlyAcad.Select(handle => OnlyAcad(acadByHandle[handle])).ToArray(),
            OnlyThcad: onlyThcad.Select(handle => OnlyThcad(thcadByHandle[handle])).ToArray(),
            TypeCrosswalk: crosswalk,
            ThcadProfessionalEntityCount: thcadProfessional.Length,
            ProfessionalMappings: professionalMappings,
            DataCoverage: Coverage(acadSharp.Entities, thcad),
            GeometryParity: parity,
            BoundingBoxParity: boundingBoxParity);
    }

    public static string NormalizeHandle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "0";
        var normalized = value.Trim().TrimStart('0').ToUpperInvariant();
        return normalized.Length == 0 ? "0" : normalized;
    }

    private static List<ThcadEntitySnapshot> LoadThcadEntities(string path)
    {
        var result = new List<ThcadEntitySnapshot>();
        foreach (var line in File.ReadLines(path))
        {
            if (string.IsNullOrWhiteSpace(line))
                continue;
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            var geometry = root.TryGetProperty("geometry", out var geometryElement) ? geometryElement : default;
            var bbox = root.TryGetProperty("bbox", out var bboxElement) ? bboxElement : default;
            var text = root.TryGetProperty("text", out var textElement) ? TextValue(textElement) : null;
            var rawText = root.TryGetProperty("text", out textElement) ? RawTextValue(textElement) : null;
            result.Add(new ThcadEntitySnapshot(
                Handle: NormalizeHandle(String(root, "handle")),
                RuntimeClass: String(root, "runtime_class") ?? "<null>",
                DxfName: String(root, "dxf_name"),
                OwnerScope: String(root, "owner_scope"),
                OwnerBlockName: String(root, "owner_block_name"),
                GeometryKind: geometry.ValueKind == JsonValueKind.Object ? String(geometry, "kind") : null,
                HasBoundingBox: bbox.ValueKind == JsonValueKind.Object,
                HasText: root.TryGetProperty("text", out _),
                HasAttributes: NonEmpty(root, "attributes"),
                HasXData: NonEmpty(root, "xdata"),
                HasExtensionDictionary: root.TryGetProperty("extension_dictionary", out _),
                HasCustom: root.TryGetProperty("custom", out _),
                Facts: new ComparableEntityFacts(
                    Start: Vector(geometry, "start"),
                    End: Vector(geometry, "end"),
                    Center: Vector(geometry, "center"),
                    Position: Vector(geometry, "position") ?? Vector(geometry, "location"),
                    Radius: Number(geometry, "radius"),
                    StartAngle: Number(geometry, "start_angle"),
                    EndAngle: Number(geometry, "end_angle"),
                    Measurement: Number(geometry, "measurement"),
                    PlanarMeasurement: Number(geometry, "measurement"),
                    Text: text,
                    RawText: rawText),
                BoundingBoxFacts: MakeBoundingBoxFacts(Vector(bbox, "min"), Vector(bbox, "max"))));
        }
        return result;
    }

    private static DataCoverage Coverage(IReadOnlyCollection<EntitySnapshot> acad, IReadOnlyCollection<ThcadEntitySnapshot> thcad) => new(
        AcadSharp: new SortedDictionary<string, int>(StringComparer.Ordinal)
        {
            ["attributes"] = acad.Count(entity => CollectionPropertyCount(entity.Properties, "Attributes") > 0),
            ["bounding_box"] = acad.Count(entity => entity.BoundingBox is not null && entity.BoundingBoxError is null),
            ["extended_dictionary"] = acad.Count(entity => entity.HasXDictionary),
            ["proxy_entities"] = acad.Count(entity => entity.Proxy is not null),
            ["proxy_entities_with_graphics"] = acad.Count(entity => entity.Proxy?.Graphics.Count > 0),
            ["text"] = acad.Count(entity => entity.ComparableFacts.Text is not null || entity.ComparableFacts.RawText is not null),
            ["type_specific_properties"] = acad.Count(entity => entity.Properties.Count > 0),
            ["xdata"] = acad.Count(entity => entity.XDataApplications.Count > 0),
        },
        Thcad: new SortedDictionary<string, int>(StringComparer.Ordinal)
        {
            ["attributes"] = thcad.Count(entity => entity.HasAttributes),
            ["bounding_box"] = thcad.Count(entity => entity.HasBoundingBox),
            ["custom"] = thcad.Count(entity => entity.HasCustom),
            ["extension_dictionary"] = thcad.Count(entity => entity.HasExtensionDictionary),
            ["text"] = thcad.Count(entity => entity.HasText),
            ["xdata"] = thcad.Count(entity => entity.HasXData),
        });

    private static int CollectionPropertyCount(IReadOnlyDictionary<string, object?> properties, string name)
    {
        if (!properties.TryGetValue(name, out var value) || value is null)
            return 0;
        if (value is ICollection collection)
            return collection.Count;
        return value is IEnumerable ? 1 : 0;
    }

    private static OnlyEntitySnapshot OnlyAcad(EntitySnapshot entity) => new(
        entity.Handle,
        entity.AcadSharpType,
        entity.ObjectName,
        entity.OwnerScope,
        entity.OwnerBlockName,
        entity.Proxy?.DxfClass?.CppClassName,
        entity.Proxy?.DxfClass?.DxfName,
        entity.Proxy?.Graphics.Count ?? 0);

    private static OnlyEntitySnapshot OnlyThcad(ThcadEntitySnapshot entity) => new(
        entity.Handle,
        entity.RuntimeClass,
        entity.DxfName,
        entity.OwnerScope,
        entity.OwnerBlockName,
        null,
        null,
        0);

    private static string? String(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static double? Number(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.TryGetDouble(out var number)
            ? number
            : null;

    private static double[]? Vector(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
            return null;
        var numbers = value.EnumerateArray().Select(item => item.GetDouble()).ToArray();
        return numbers.Length >= 2 ? [numbers[0], numbers[1], numbers.Length > 2 ? numbers[2] : 0.0] : null;
    }

    private static string? TextValue(JsonElement text)
    {
        if (text.ValueKind == JsonValueKind.String)
            return text.GetString();
        if (text.ValueKind != JsonValueKind.Object)
            return null;
        return String(text, "plain") ?? String(text, "value") ?? String(text, "dimension_text") ?? String(text, "contents");
    }

    private static string? RawTextValue(JsonElement text)
    {
        if (text.ValueKind == JsonValueKind.String)
            return text.GetString();
        if (text.ValueKind != JsonValueKind.Object)
            return null;
        return String(text, "contents") ?? String(text, "value") ?? String(text, "dimension_text") ?? String(text, "plain");
    }

    private static bool NonEmpty(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value))
            return false;
        return value.ValueKind switch
        {
            JsonValueKind.Array => value.GetArrayLength() > 0,
            JsonValueKind.Object => value.EnumerateObject().Any(),
            JsonValueKind.Null => false,
            _ => true,
        };
    }

    private static BoundingBoxFacts? MakeBoundingBoxFacts(double[]? min, double[]? max)
    {
        if (min is null || max is null)
            return null;
        var finite = min.Concat(max).All(double.IsFinite);
        var degenerate = finite && Enumerable.Range(0, 3).All(index => Math.Abs(max[index] - min[index]) <= 1e-10);
        return new BoundingBoxFacts(min, max, finite, degenerate);
    }
}

static class BoundingBoxParity
{
    public static IReadOnlyList<BoundingBoxParityResult> Build(IEnumerable<(EntitySnapshot Acad, ThcadEntitySnapshot Thcad)> pairs)
    {
        return pairs.GroupBy(pair => pair.Thcad.RuntimeClass, StringComparer.Ordinal)
            .Select(group =>
            {
                var available = 0;
                var matched = 0;
                var mismatched = 0;
                var acadDegenerate = 0;
                var thcadDegenerate = 0;
                var unavailable = 0;
                foreach (var (acad, thcad) in group)
                {
                    var left = acad.BoundingBoxFacts;
                    var right = thcad.BoundingBoxFacts;
                    if (left is null || right is null || !left.IsFinite || !right.IsFinite)
                    {
                        unavailable++;
                        continue;
                    }
                    available++;
                    if (left.IsDegenerate)
                        acadDegenerate++;
                    if (right.IsDegenerate)
                        thcadDegenerate++;
                    if (VectorsEqual(left.Min, right.Min) && VectorsEqual(left.Max, right.Max))
                        matched++;
                    else
                        mismatched++;
                }
                return new BoundingBoxParityResult(group.Key, group.Count(), available, matched, mismatched, unavailable, acadDegenerate, thcadDegenerate);
            })
            .OrderByDescending(item => item.Total)
            .ThenBy(item => item.ThcadRuntimeClass, StringComparer.Ordinal)
            .ToArray();
    }

    private static bool VectorsEqual(double[] left, double[] right) =>
        left.Length >= 3 && right.Length >= 3
        && NumbersEqual(left[0], right[0]) && NumbersEqual(left[1], right[1]) && NumbersEqual(left[2], right[2]);

    private static bool NumbersEqual(double left, double right)
    {
        var tolerance = 1e-8 * Math.Max(1.0, Math.Max(Math.Abs(left), Math.Abs(right)));
        return Math.Abs(left - right) <= tolerance;
    }
}

static class GeometryParity
{
    public static IReadOnlyList<ParityResult> Build(IEnumerable<(EntitySnapshot Acad, ThcadEntitySnapshot Thcad)> pairs)
    {
        var counters = new Dictionary<string, MutableParity>(StringComparer.Ordinal);
        foreach (var (acad, thcad) in pairs)
        {
            switch (thcad.RuntimeClass)
            {
                case "AcDbLine":
                    Check(counters, "line.start_end", VectorsEqual(acad.ComparableFacts.Start, thcad.Facts.Start)
                                                               && VectorsEqual(acad.ComparableFacts.End, thcad.Facts.End),
                        acad.ComparableFacts.Start is not null && acad.ComparableFacts.End is not null && thcad.Facts.Start is not null && thcad.Facts.End is not null,
                        acad.Handle);
                    break;
                case "AcDbCircle":
                    Check(counters, "circle.center_radius", VectorsEqual(acad.ComparableFacts.Center, thcad.Facts.Center)
                                                                  && NumbersEqual(acad.ComparableFacts.Radius, thcad.Facts.Radius),
                        acad.ComparableFacts.Center is not null && acad.ComparableFacts.Radius.HasValue && thcad.Facts.Center is not null && thcad.Facts.Radius.HasValue,
                        acad.Handle);
                    break;
                case "AcDbArc":
                    Check(counters, "arc.center_radius_angles", VectorsEqual(acad.ComparableFacts.Center, thcad.Facts.Center)
                                                                      && NumbersEqual(acad.ComparableFacts.Radius, thcad.Facts.Radius)
                                                                      && NumbersEqual(acad.ComparableFacts.StartAngle, thcad.Facts.StartAngle)
                                                                      && NumbersEqual(acad.ComparableFacts.EndAngle, thcad.Facts.EndAngle),
                        acad.ComparableFacts.Center is not null && acad.ComparableFacts.Radius.HasValue
                        && acad.ComparableFacts.StartAngle.HasValue && acad.ComparableFacts.EndAngle.HasValue
                        && thcad.Facts.Center is not null && thcad.Facts.Radius.HasValue
                        && thcad.Facts.StartAngle.HasValue && thcad.Facts.EndAngle.HasValue,
                        acad.Handle);
                    break;
                case "AcDbPoint":
                    Check(counters, "point.position_vs_thcad_bbox", VectorsEqual(acad.ComparableFacts.Position, thcad.BoundingBoxFacts?.Min),
                        acad.ComparableFacts.Position is not null && thcad.BoundingBoxFacts?.Min is not null,
                        acad.Handle);
                    break;
                case "AcDbText":
                    Check(counters, "text.content", string.Equals(acad.ComparableFacts.Text, thcad.Facts.Text, StringComparison.Ordinal),
                        acad.ComparableFacts.Text is not null && thcad.Facts.Text is not null,
                        acad.Handle);
                    break;
                case "AcDbMText":
                    Check(counters, "mtext.plain_text", string.Equals(acad.ComparableFacts.Text, thcad.Facts.Text, StringComparison.Ordinal),
                        acad.ComparableFacts.Text is not null && thcad.Facts.Text is not null,
                        acad.Handle);
                    Check(counters, "mtext.plain_text_case_insensitive", string.Equals(acad.ComparableFacts.Text, thcad.Facts.Text, StringComparison.OrdinalIgnoreCase),
                        acad.ComparableFacts.Text is not null && thcad.Facts.Text is not null,
                        acad.Handle);
                    Check(counters, "mtext.raw_contents", string.Equals(acad.ComparableFacts.RawText, thcad.Facts.RawText, StringComparison.Ordinal),
                        acad.ComparableFacts.RawText is not null && thcad.Facts.RawText is not null,
                        acad.Handle);
                    break;
                case "AcDbBlockReference":
                    Check(counters, "insert.position", VectorsEqual(acad.ComparableFacts.Position, thcad.Facts.Position),
                        acad.ComparableFacts.Position is not null && thcad.Facts.Position is not null,
                        acad.Handle);
                    break;
                case "AcDbRotatedDimension":
                case "AcDbDiametricDimension":
                    Check(counters, "dimension.measurement", NumbersEqual(acad.ComparableFacts.Measurement, thcad.Facts.Measurement),
                        acad.ComparableFacts.Measurement.HasValue && thcad.Facts.Measurement.HasValue,
                        acad.Handle);
                    break;
                case "AcDbAlignedDimension":
                    Check(counters, "dimension.measurement", NumbersEqual(acad.ComparableFacts.Measurement, thcad.Facts.Measurement),
                        acad.ComparableFacts.Measurement.HasValue && thcad.Facts.Measurement.HasValue,
                        acad.Handle);
                    Check(counters, "aligned_dimension.planar_measurement", NumbersEqual(acad.ComparableFacts.PlanarMeasurement, thcad.Facts.Measurement),
                        acad.ComparableFacts.PlanarMeasurement.HasValue && thcad.Facts.Measurement.HasValue,
                        acad.Handle);
                    break;
            }
        }

        return counters.OrderBy(item => item.Key, StringComparer.Ordinal)
            .Select(item => new ParityResult(item.Key, item.Value.Attempted, item.Value.Matched, item.Value.Mismatched, item.Value.Unavailable, item.Value.MismatchHandles))
            .ToArray();
    }

    private static void Check(Dictionary<string, MutableParity> counters, string metric, bool equal, bool available, string handle)
    {
        if (!counters.TryGetValue(metric, out var counter))
        {
            counter = new MutableParity();
            counters[metric] = counter;
        }
        if (!available)
        {
            counter.Unavailable++;
            return;
        }
        counter.Attempted++;
        if (equal)
            counter.Matched++;
        else
        {
            counter.Mismatched++;
            if (counter.MismatchHandles.Count < 100)
                counter.MismatchHandles.Add(handle);
        }
    }

    private static bool VectorsEqual(double[]? left, double[]? right) =>
        left is not null && right is not null && left.Length >= 3 && right.Length >= 3
        && NumbersEqual(left[0], right[0]) && NumbersEqual(left[1], right[1]) && NumbersEqual(left[2], right[2]);

    private static bool NumbersEqual(double? left, double? right)
    {
        if (!left.HasValue || !right.HasValue)
            return false;
        var tolerance = 1e-8 * Math.Max(1.0, Math.Max(Math.Abs(left.Value), Math.Abs(right.Value)));
        return Math.Abs(left.Value - right.Value) <= tolerance;
    }

    private sealed class MutableParity
    {
        public int Attempted { get; set; }
        public int Matched { get; set; }
        public int Mismatched { get; set; }
        public int Unavailable { get; set; }
        public List<string> MismatchHandles { get; } = [];
    }
}

static class AggregateBuilder
{
    public static AggregateReport Build(IReadOnlyCollection<DrawingRunResult> runs, Options options)
    {
        var successful = runs.Where(run => run.Report is not null && run.Comparison is not null).ToArray();
        var parity = successful.SelectMany(run => run.Comparison!.GeometryParity)
            .GroupBy(item => item.Metric, StringComparer.Ordinal)
            .Select(group => new ParityResult(
                group.Key,
                group.Sum(item => item.Attempted),
                group.Sum(item => item.Matched),
                group.Sum(item => item.Mismatched),
                group.Sum(item => item.Unavailable),
                group.SelectMany(item => item.MismatchHandles).Take(100).ToArray()))
            .OrderBy(item => item.Metric, StringComparer.Ordinal)
            .ToArray();
        var boundingBoxParity = successful.SelectMany(run => run.Comparison!.BoundingBoxParity)
            .GroupBy(item => item.ThcadRuntimeClass, StringComparer.Ordinal)
            .Select(group => new BoundingBoxParityResult(
                group.Key,
                group.Sum(item => item.Total),
                group.Sum(item => item.Available),
                group.Sum(item => item.Matched),
                group.Sum(item => item.Mismatched),
                group.Sum(item => item.Unavailable),
                group.Sum(item => item.AcadSharpDegenerate),
                group.Sum(item => item.ThcadDegenerate)))
            .OrderByDescending(item => item.Total)
            .ThenBy(item => item.ThcadRuntimeClass, StringComparer.Ordinal)
            .ToArray();

        return new AggregateReport(
            GeneratedAtUtc: DateTimeOffset.UtcNow,
            DrawingInput: options.DrawingInput,
            ThcadRoot: options.ThcadRoot,
            OutputRoot: options.OutputRoot,
            LibraryVersion: typeof(CadDocument).Assembly.GetName().Version?.ToString() ?? "unknown",
            DrawingCount: runs.Count,
            SuccessfulDrawingCount: successful.Length,
            FailedDrawingCount: runs.Count - successful.Length,
            AcadSharpEntityCount: successful.Sum(run => run.Report!.EntityCount),
            ThcadEntityCount: successful.Sum(run => run.Comparison!.ThcadEntityCount),
            SharedHandleCount: successful.Sum(run => run.Comparison!.SharedHandleCount),
            OnlyAcadSharpCount: successful.Sum(run => run.Comparison!.OnlyAcadSharpCount),
            OnlyThcadCount: successful.Sum(run => run.Comparison!.OnlyThcadCount),
            ProxyEntityCount: successful.Sum(run => run.Report!.ProxyEntityCount),
            ProxyEntityWithGraphicsCount: successful.Sum(run => run.Report!.ProxyEntityWithGraphicsCount),
            ProxyGraphicCount: successful.Sum(run => run.Report!.ProxyGraphicCount),
            EntityTypeCounts: MergeCounts(successful.Select(run => run.Report!.EntityTypeCounts)),
            ProxyClassCounts: MergeCounts(successful.Select(run => run.Report!.ProxyClassCounts)),
            ProxyGraphicTypeCounts: MergeCounts(successful.Select(run => run.Report!.ProxyGraphicTypeCounts)),
            DataCoverage: new DataCoverage(
                MergeCounts(successful.Select(run => run.Comparison!.DataCoverage.AcadSharp)),
                MergeCounts(successful.Select(run => run.Comparison!.DataCoverage.Thcad))),
            NotificationCount: successful.Sum(run => run.Report!.NotificationCount),
            ReadElapsedMs: successful.Sum(run => run.Report!.ElapsedMs),
            GeometryParity: parity,
            BoundingBoxParity: boundingBoxParity,
            Drawings: runs.OrderBy(run => run.DrawingId, StringComparer.Ordinal).ToArray());
    }

    private static SortedDictionary<string, int> MergeCounts(IEnumerable<IReadOnlyDictionary<string, int>> dictionaries)
    {
        var result = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var dictionary in dictionaries)
        {
            foreach (var (key, value) in dictionary)
            {
                result[key] = result.GetValueOrDefault(key) + value;
            }
        }

        return result;
    }
}

static class JsonFiles
{
    private static readonly JsonSerializerOptions Compact = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonSerializerOptions Indented = new(Compact) { WriteIndented = true };

    public static void Write<T>(string path, T value) =>
        File.WriteAllText(path, JsonSerializer.Serialize(value, Indented) + Environment.NewLine, new UTF8Encoding(false));

    public static void WriteJsonLines<T>(string path, IEnumerable<T> values)
    {
        using var writer = new StreamWriter(path, false, new UTF8Encoding(false));
        foreach (var value in values)
            writer.WriteLine(JsonSerializer.Serialize(value, Compact));
    }
}

sealed record DrawingExtraction(
    IReadOnlyList<EntitySnapshot> Entities,
    IReadOnlyList<DictionaryEntrySnapshot> DictionaryEntries,
    IReadOnlyList<ReaderNotification> Notifications,
    AcadSharpReport Report);

sealed record EntitySnapshot(
    string Handle,
    string AcadSharpType,
    string ObjectName,
    string ObjectType,
    string SubclassMarker,
    string OwnerScope,
    string OwnerBlockName,
    string OwnerHandle,
    string? Layer,
    string? LineType,
    string LineWeight,
    bool Visible,
    object? Color,
    object? Transparency,
    object? BoundingBox,
    BoundingBoxFacts? BoundingBoxFacts,
    string? BoundingBoxError,
    IReadOnlyList<string> XDataApplications,
    object? XData,
    bool HasXDictionary,
    IReadOnlyList<string> XDictionaryKeys,
    IReadOnlyDictionary<string, object?> Properties,
    IReadOnlyList<string> PropertyErrors,
    ComparableEntityFacts ComparableFacts,
    ProxySnapshot? Proxy);

sealed record ComparableEntityFacts(
    double[]? Start,
    double[]? End,
    double[]? Center,
    double[]? Position,
    double? Radius,
    double? StartAngle,
    double? EndAngle,
    double? Measurement,
    double? PlanarMeasurement,
    string? Text,
    string? RawText);

sealed record BoundingBoxFacts(double[] Min, double[] Max, bool IsFinite, bool IsDegenerate);

sealed record ProxySnapshot(
    int ClassId,
    int DrawingFormat,
    string Version,
    bool OriginalDataFormatDxf,
    DxfClassSnapshot? DxfClass,
    IReadOnlyList<ProxyGraphicSnapshot> Graphics);

sealed record ProxyGraphicSnapshot(string Type, object? Data);

sealed record DxfClassSnapshot(
    int ClassNumber,
    string DxfName,
    string CppClassName,
    string ApplicationName,
    bool IsEntity,
    int InstanceCount,
    bool WasZombie,
    string ProxyFlags);

sealed record DictionaryEntrySnapshot(
    string Path,
    string Key,
    string? Type,
    string? Handle,
    string? ObjectName,
    DxfClassSnapshot? DxfClass);

sealed record ReaderNotification(string Type, string Message);

sealed record ReaderConfigurationSnapshot(
    bool Failsafe,
    bool KeepUnknownEntities,
    bool KeepUnknownNonGraphicalObjects,
    bool IgnoreProxyGraphics,
    bool ProxyGraphicsApiAvailable);

sealed record AcadSharpReport(
    string SourcePath,
    long SourceSizeBytes,
    string SourceSha256,
    string LibraryVersion,
    double ElapsedMs,
    ReaderConfigurationSnapshot ReaderConfiguration,
    int EntityCount,
    int ModelSpaceEntityCount,
    int PaperSpaceEntityCount,
    int BlockDefinitionEntityCount,
    int ZeroHandleEntityCount,
    int DuplicateHandleCount,
    int ProxyEntityCount,
    int UnknownEntityCount,
    int ProxyEntityWithGraphicsCount,
    int ProxyGraphicCount,
    IReadOnlyDictionary<string, int> ProxyGraphicTypeCounts,
    IReadOnlyDictionary<string, int> EntityTypeCounts,
    IReadOnlyDictionary<string, int> ObjectNameCounts,
    IReadOnlyDictionary<string, int> ProxyClassCounts,
    int BlockRecordCount,
    IReadOnlyDictionary<string, int> TableCounts,
    int DictionaryEntryCount,
    IReadOnlyList<string> RootDictionaryKeys,
    IReadOnlyList<DxfClassSnapshot> DxfClasses,
    IReadOnlyList<DxfClassSnapshot> CustomDxfClasses,
    int NotificationCount,
    IReadOnlyDictionary<string, int> NotificationTypeCounts);

sealed record ThcadEntitySnapshot(
    string Handle,
    string RuntimeClass,
    string? DxfName,
    string? OwnerScope,
    string? OwnerBlockName,
    string? GeometryKind,
    bool HasBoundingBox,
    bool HasText,
    bool HasAttributes,
    bool HasXData,
    bool HasExtensionDictionary,
    bool HasCustom,
    ComparableEntityFacts Facts,
    BoundingBoxFacts? BoundingBoxFacts);

sealed record TypeCrosswalk(string ThcadRuntimeClass, string AcadSharpType, string? AcadSharpProxyClass, int Count);

sealed record ProfessionalMapping(
    string Handle,
    string ThcadRuntimeClass,
    string? ThcadDxfName,
    string? AcadSharpType,
    string? AcadSharpProxyClass,
    string? AcadSharpProxyDxfName,
    int ProxyGraphicCount,
    IReadOnlyList<string> ProxyGraphicTypes);

sealed record OnlyEntitySnapshot(
    string Handle,
    string Type,
    string? ObjectName,
    string? OwnerScope,
    string? OwnerBlockName,
    string? ProxyClass,
    string? ProxyDxfName,
    int ProxyGraphicCount);

sealed record DataCoverage(
    IReadOnlyDictionary<string, int> AcadSharp,
    IReadOnlyDictionary<string, int> Thcad);

sealed record ParityResult(
    string Metric,
    int Attempted,
    int Matched,
    int Mismatched,
    int Unavailable,
    IReadOnlyList<string> MismatchHandles);

sealed record BoundingBoxParityResult(
    string ThcadRuntimeClass,
    int Total,
    int Available,
    int Matched,
    int Mismatched,
    int Unavailable,
    int AcadSharpDegenerate,
    int ThcadDegenerate);

sealed record ComparisonReport(
    bool ThcadAvailable,
    string ThcadEntitiesPath,
    int AcadSharpEntityCount,
    int ThcadEntityCount,
    int SharedHandleCount,
    int OnlyAcadSharpCount,
    int OnlyThcadCount,
    IReadOnlyList<OnlyEntitySnapshot> OnlyAcadSharp,
    IReadOnlyList<OnlyEntitySnapshot> OnlyThcad,
    IReadOnlyList<TypeCrosswalk> TypeCrosswalk,
    int ThcadProfessionalEntityCount,
    IReadOnlyList<ProfessionalMapping> ProfessionalMappings,
    DataCoverage DataCoverage,
    IReadOnlyList<ParityResult> GeometryParity,
    IReadOnlyList<BoundingBoxParityResult> BoundingBoxParity)
{
    public static ComparisonReport Missing(string path, int acadSharpCount) => new(
        false, path, acadSharpCount, 0, 0, 0, 0, [], [], [], 0, [],
        new DataCoverage(new SortedDictionary<string, int>(), new SortedDictionary<string, int>()), [], []);
}

sealed record FailureInfo(string Type, string Message, string? StackTrace);

sealed record DrawingRunResult(
    string DrawingId,
    AcadSharpReport? Report,
    ComparisonReport? Comparison,
    FailureInfo? Failure);

sealed record AggregateReport(
    DateTimeOffset GeneratedAtUtc,
    string DrawingInput,
    string ThcadRoot,
    string OutputRoot,
    string LibraryVersion,
    int DrawingCount,
    int SuccessfulDrawingCount,
    int FailedDrawingCount,
    int AcadSharpEntityCount,
    int ThcadEntityCount,
    int SharedHandleCount,
    int OnlyAcadSharpCount,
    int OnlyThcadCount,
    int ProxyEntityCount,
    int ProxyEntityWithGraphicsCount,
    int ProxyGraphicCount,
    IReadOnlyDictionary<string, int> EntityTypeCounts,
    IReadOnlyDictionary<string, int> ProxyClassCounts,
    IReadOnlyDictionary<string, int> ProxyGraphicTypeCounts,
    DataCoverage DataCoverage,
    int NotificationCount,
    double ReadElapsedMs,
    IReadOnlyList<ParityResult> GeometryParity,
    IReadOnlyList<BoundingBoxParityResult> BoundingBoxParity,
    IReadOnlyList<DrawingRunResult> Drawings);
