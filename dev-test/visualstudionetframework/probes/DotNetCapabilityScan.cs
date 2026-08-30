using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace Shb.Thcad.Probes
{
    /// <summary>
    /// Reflects already-loaded ReflectionOnly assemblies into a path-free scan document.
    /// C# 5 compatible for Windows PowerShell Add-Type.
    /// </summary>
    public static class DotNetCapabilityScan
    {
        public static string ScanNamedAssembly(
            string assemblyName,
            string fileName,
            string version,
            string sha256,
            IList<string> aggregatedReflectionErrors)
        {
            if (assemblyName == null)
            {
                throw new ArgumentNullException("assemblyName");
            }

            Assembly assembly = FindReflectionOnly(assemblyName);
            if (assembly == null)
            {
                if (aggregatedReflectionErrors != null)
                {
                    aggregatedReflectionErrors.Add(ErrorObject(assemblyName, "assembly not loaded in ReflectionOnly context"));
                }
                return EmptyAssembly(assemblyName, fileName, version, sha256);
            }

            List<string> reflectionErrors = new List<string>();
            Type[] exported = GetExportedTypes(assembly, reflectionErrors);

            List<Type> types = new List<Type>();
            for (int i = 0; i < exported.Length; i++)
            {
                if (exported[i] != null)
                {
                    types.Add(exported[i]);
                }
            }
            types.Sort(CompareTypes);

            BindingFlags flags =
                BindingFlags.Public |
                BindingFlags.Instance |
                BindingFlags.Static |
                BindingFlags.DeclaredOnly;

            int methodOverloads = 0;
            int properties = 0;
            int events = 0;
            int constructors = 0;
            int fields = 0;
            int enumLiterals = 0;

            StringBuilder typesJson = new StringBuilder();
            typesJson.Append('[');
            for (int i = 0; i < types.Count; i++)
            {
                if (i > 0)
                {
                    typesJson.Append(',');
                }
                int typeMethods;
                int typeProperties;
                int typeEvents;
                int typeConstructors;
                int typeFields;
                int typeEnumLiterals;
                WriteType(
                    typesJson,
                    types[i],
                    flags,
                    reflectionErrors,
                    out typeMethods,
                    out typeProperties,
                    out typeEvents,
                    out typeConstructors,
                    out typeFields,
                    out typeEnumLiterals);
                methodOverloads += typeMethods;
                properties += typeProperties;
                events += typeEvents;
                constructors += typeConstructors;
                fields += typeFields;
                enumLiterals += typeEnumLiterals;
            }
            typesJson.Append(']');

            if (aggregatedReflectionErrors != null)
            {
                for (int i = 0; i < reflectionErrors.Count; i++)
                {
                    aggregatedReflectionErrors.Add(ErrorObject(assemblyName, reflectionErrors[i]));
                }
            }

            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, assemblyName);
            json.Append(',');
            WriteKey(json, "file_name");
            WriteString(json, fileName);
            json.Append(',');
            WriteKey(json, "version");
            WriteStringOrNull(json, EmptyToNull(version));
            json.Append(',');
            WriteKey(json, "sha256");
            WriteStringOrNull(json, EmptyToNull(sha256));
            json.Append(',');
            WriteKey(json, "public_type_count");
            json.Append(types.Count.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_method_overload_count");
            json.Append(methodOverloads.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_property_count");
            json.Append(properties.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_event_count");
            json.Append(events.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_constructor_count");
            json.Append(constructors.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_field_count");
            json.Append(fields.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "enum_literal_count");
            json.Append(enumLiterals.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "reflection_errors");
            WriteStringArray(json, reflectionErrors);
            json.Append(',');
            WriteKey(json, "types");
            json.Append(typesJson.ToString());
            json.Append('}');
            return json.ToString();
        }

        public static string EmptyAssembly(string name, string fileName, string version, string sha256)
        {
            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, name);
            json.Append(',');
            WriteKey(json, "file_name");
            WriteString(json, fileName);
            json.Append(',');
            WriteKey(json, "version");
            WriteStringOrNull(json, EmptyToNull(version));
            json.Append(',');
            WriteKey(json, "sha256");
            WriteStringOrNull(json, EmptyToNull(sha256));
            json.Append(',');
            WriteKey(json, "public_type_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_method_overload_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_property_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_event_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_constructor_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_field_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "enum_literal_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "reflection_errors");
            json.Append("[]");
            json.Append(',');
            WriteKey(json, "types");
            json.Append("[]");
            json.Append('}');
            return json.ToString();
        }

        public static string ErrorObject(string source, string message)
        {
            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "source");
            WriteString(json, source);
            json.Append(',');
            WriteKey(json, "message");
            WriteString(json, SanitizeMessage(message));
            json.Append('}');
            return json.ToString();
        }

        public static void WriteScanDocument(
            string outputPath,
            string inventoryId,
            string observedHostId,
            IList<string> assemblyJsonObjects,
            IList<string> conversionErrorJsonObjects,
            IList<string> reflectionErrorJsonObjects)
        {
            if (outputPath == null)
            {
                throw new ArgumentNullException("outputPath");
            }

            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "inventory_id");
            WriteString(json, inventoryId);
            json.Append(',');
            WriteKey(json, "observed_host_id");
            WriteString(json, observedHostId);
            json.Append(',');
            WriteKey(json, "assemblies");
            WriteRawObjectArray(json, assemblyJsonObjects);
            json.Append(',');
            WriteKey(json, "conversion_errors");
            WriteRawObjectArray(json, conversionErrorJsonObjects);
            json.Append(',');
            WriteKey(json, "reflection_errors");
            WriteRawObjectArray(json, reflectionErrorJsonObjects);
            json.Append('}');
            File.WriteAllText(outputPath, json.ToString(), new UTF8Encoding(false));
        }

        static Assembly FindReflectionOnly(string assemblyName)
        {
            Assembly[] loaded = AppDomain.CurrentDomain.ReflectionOnlyGetAssemblies();
            for (int i = 0; i < loaded.Length; i++)
            {
                if (string.Equals(loaded[i].GetName().Name, assemblyName, StringComparison.Ordinal))
                {
                    return loaded[i];
                }
            }
            return null;
        }

        static Type[] GetExportedTypes(Assembly assembly, List<string> reflectionErrors)
        {
            try
            {
                return assembly.GetExportedTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                if (ex.LoaderExceptions != null)
                {
                    for (int i = 0; i < ex.LoaderExceptions.Length; i++)
                    {
                        Exception loaderError = ex.LoaderExceptions[i];
                        if (loaderError != null)
                        {
                            reflectionErrors.Add(SanitizeMessage(loaderError.Message));
                        }
                    }
                }
                List<Type> surviving = new List<Type>();
                if (ex.Types != null)
                {
                    for (int i = 0; i < ex.Types.Length; i++)
                    {
                        if (ex.Types[i] != null)
                        {
                            surviving.Add(ex.Types[i]);
                        }
                    }
                }
                return surviving.ToArray();
            }
        }

        static void WriteType(
            StringBuilder json,
            Type type,
            BindingFlags flags,
            List<string> reflectionErrors,
            out int methodCount,
            out int propertyCount,
            out int eventCount,
            out int constructorCount,
            out int fieldCount,
            out int enumLiteralCount)
        {
            methodCount = 0;
            propertyCount = 0;
            eventCount = 0;
            constructorCount = 0;
            fieldCount = 0;
            enumLiteralCount = 0;
            MethodInfo[] methods = new MethodInfo[0];
            PropertyInfo[] properties = new PropertyInfo[0];
            EventInfo[] events = new EventInfo[0];
            ConstructorInfo[] constructors = new ConstructorInfo[0];
            FieldInfo[] fields = new FieldInfo[0];
            try
            {
                methods = FilterMethods(type.GetMethods(flags));
                Array.Sort(methods, CompareMethods);
                properties = type.GetProperties(flags);
                Array.Sort(properties, CompareProperties);
                events = type.GetEvents(flags);
                Array.Sort(events, CompareEvents);
                constructors = type.GetConstructors(flags);
                Array.Sort(constructors, CompareConstructors);
                fields = type.GetFields(flags);
                Array.Sort(fields, CompareFields);
            }
            catch (Exception ex)
            {
                reflectionErrors.Add(SanitizeMessage((type.FullName ?? type.Name) + ": " + ex.Message));
            }

            methodCount = methods.Length;
            propertyCount = properties.Length;
            eventCount = events.Length;
            constructorCount = constructors.Length;
            fieldCount = fields.Length;
            if (type.IsEnum)
            {
                enumLiteralCount = CountEnumLiterals(fields);
            }

            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, type.Name);
            json.Append(',');
            WriteKey(json, "full_name");
            WriteString(json, TypeFullName(type));
            json.Append(',');
            WriteKey(json, "kind");
            WriteString(json, TypeKind(type));
            json.Append(',');
            WriteKey(json, "is_enum");
            json.Append(type.IsEnum ? "true" : "false");
            json.Append(',');
            WriteKey(json, "methods");
            json.Append('[');
            for (int i = 0; i < methods.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteMethod(json, methods[i]);
            }
            json.Append(']');
            json.Append(',');
            WriteKey(json, "properties");
            json.Append('[');
            for (int i = 0; i < properties.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteProperty(json, properties[i]);
            }
            json.Append(']');
            json.Append(',');
            WriteKey(json, "events");
            json.Append('[');
            for (int i = 0; i < events.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteEvent(json, events[i]);
            }
            json.Append(']');
            json.Append(',');
            WriteKey(json, "constructors");
            json.Append('[');
            for (int i = 0; i < constructors.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteConstructor(json, constructors[i]);
            }
            json.Append(']');
            json.Append(',');
            WriteKey(json, "fields");
            json.Append('[');
            for (int i = 0; i < fields.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteField(json, fields[i]);
            }
            json.Append(']');
            json.Append('}');
        }

        static int CountEnumLiterals(FieldInfo[] fields)
        {
            int count = 0;
            for (int i = 0; i < fields.Length; i++)
            {
                if (fields[i].IsLiteral && !fields[i].IsSpecialName)
                {
                    count++;
                }
            }
            return count;
        }

        static MethodInfo[] FilterMethods(MethodInfo[] methods)
        {
            List<MethodInfo> filtered = new List<MethodInfo>();
            for (int i = 0; i < methods.Length; i++)
            {
                MethodInfo method = methods[i];
                if (method == null)
                {
                    continue;
                }
                if (!method.IsSpecialName || method.Name.StartsWith("op_", StringComparison.Ordinal))
                {
                    filtered.Add(method);
                }
            }
            return filtered.ToArray();
        }

        static void WriteMethod(StringBuilder json, MethodInfo method)
        {
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, MethodDisplayName(method));
            json.Append(',');
            WriteKey(json, "return_type");
            WriteString(json, FormatType(method.ReturnType));
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(method.IsStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "parameters");
            WriteParameters(json, method.GetParameters());
            json.Append('}');
        }

        static string MethodDisplayName(MethodInfo method)
        {
            if (!method.IsGenericMethod)
            {
                return method.Name;
            }
            Type[] args = method.GetGenericArguments();
            StringBuilder name = new StringBuilder();
            name.Append(method.Name);
            name.Append('[');
            for (int i = 0; i < args.Length; i++)
            {
                if (i > 0)
                {
                    name.Append(',');
                }
                name.Append(FormatType(args[i]));
            }
            name.Append(']');
            return name.ToString();
        }

        static void WriteProperty(StringBuilder json, PropertyInfo property)
        {
            MethodInfo getter = property.GetGetMethod(false);
            MethodInfo setter = property.GetSetMethod(false);
            bool isStatic = (getter != null && getter.IsStatic) || (setter != null && setter.IsStatic);
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, property.Name);
            json.Append(',');
            WriteKey(json, "type");
            WriteString(json, FormatType(property.PropertyType));
            json.Append(',');
            WriteKey(json, "can_read");
            json.Append(getter != null ? "true" : "false");
            json.Append(',');
            WriteKey(json, "can_write");
            json.Append(setter != null ? "true" : "false");
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(isStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "parameters");
            WriteParameters(json, property.GetIndexParameters());
            json.Append('}');
        }

        static void WriteEvent(StringBuilder json, EventInfo eventInfo)
        {
            MethodInfo addMethod = eventInfo.GetAddMethod(false);
            bool isStatic = addMethod != null && addMethod.IsStatic;
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, eventInfo.Name);
            json.Append(',');
            WriteKey(json, "handler_type");
            WriteString(json, FormatType(eventInfo.EventHandlerType));
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(isStatic ? "true" : "false");
            json.Append('}');
        }

        static void WriteConstructor(StringBuilder json, ConstructorInfo constructor)
        {
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, constructor.IsStatic ? ".cctor" : ".ctor");
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(constructor.IsStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "parameters");
            WriteParameters(json, constructor.GetParameters());
            json.Append('}');
        }

        static void WriteField(StringBuilder json, FieldInfo field)
        {
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, field.Name);
            json.Append(',');
            WriteKey(json, "type");
            WriteString(json, FormatType(field.FieldType));
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(field.IsStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "is_literal");
            json.Append(field.IsLiteral ? "true" : "false");
            json.Append(',');
            WriteKey(json, "is_init_only");
            json.Append(field.IsInitOnly ? "true" : "false");
            json.Append(',');
            WriteKey(json, "is_special_name");
            json.Append(field.IsSpecialName ? "true" : "false");
            json.Append('}');
        }

        static void WriteParameters(StringBuilder json, ParameterInfo[] parameters)
        {
            json.Append('[');
            for (int i = 0; i < parameters.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                ParameterInfo parameter = parameters[i];
                json.Append('{');
                WriteKey(json, "name");
                WriteString(json, parameter.Name ?? ("param" + i.ToString(CultureInfo.InvariantCulture)));
                json.Append(',');
                WriteKey(json, "type");
                WriteString(json, FormatType(UnwrapByRef(parameter.ParameterType)));
                json.Append(',');
                WriteKey(json, "direction");
                WriteString(json, ParameterDirection(parameter));
                json.Append(',');
                WriteKey(json, "optional");
                json.Append(parameter.IsOptional ? "true" : "false");
                object defaultValue;
                if (TryPrimitiveDefault(parameter, out defaultValue))
                {
                    json.Append(',');
                    WriteKey(json, "default_value");
                    WriteLiteral(json, defaultValue);
                }
                json.Append('}');
            }
            json.Append(']');
        }

        static string ParameterDirection(ParameterInfo parameter)
        {
            if (parameter.IsOut)
            {
                return "out";
            }
            if (parameter.ParameterType.IsByRef)
            {
                return "ref";
            }
            return "in";
        }

        static bool TryPrimitiveDefault(ParameterInfo parameter, out object value)
        {
            value = null;
            try
            {
                if (!parameter.IsOptional || !parameter.HasDefaultValue)
                {
                    return false;
                }
                object raw = parameter.DefaultValue;
                if (raw == null)
                {
                    value = null;
                    return true;
                }
                if (raw is DBNull || raw is Missing)
                {
                    return false;
                }
                Type type = raw.GetType();
                if (type.IsEnum)
                {
                    value = Convert.ToInt64(raw, CultureInfo.InvariantCulture);
                    return true;
                }
                if (raw is bool || raw is string || IsNumeric(type))
                {
                    value = raw;
                    return true;
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        static bool IsNumeric(Type type)
        {
            return type == typeof(byte) ||
                type == typeof(sbyte) ||
                type == typeof(short) ||
                type == typeof(ushort) ||
                type == typeof(int) ||
                type == typeof(uint) ||
                type == typeof(long) ||
                type == typeof(ulong) ||
                type == typeof(float) ||
                type == typeof(double) ||
                type == typeof(decimal);
        }

        static Type UnwrapByRef(Type type)
        {
            if (type != null && type.IsByRef)
            {
                return type.GetElementType();
            }
            return type;
        }

        static string FormatType(Type type)
        {
            if (type == null)
            {
                return "System.Void";
            }
            if (type.IsByRef)
            {
                return FormatType(type.GetElementType());
            }
            if (type.IsArray)
            {
                string element = FormatType(type.GetElementType());
                int rank = type.GetArrayRank();
                if (rank == 1)
                {
                    return element + "[]";
                }
                return element + "[" + new string(',', rank - 1) + "]";
            }
            if (type.IsPointer)
            {
                return FormatType(type.GetElementType()) + "*";
            }
            if (type.IsGenericParameter)
            {
                return type.Name;
            }
            if (type.IsGenericType)
            {
                Type definition = type.IsGenericTypeDefinition ? type : type.GetGenericTypeDefinition();
                string defName = definition.FullName ?? definition.Name;
                Type[] args = type.GetGenericArguments();
                if (args == null || args.Length == 0)
                {
                    return defName;
                }
                StringBuilder name = new StringBuilder();
                name.Append(defName);
                name.Append('[');
                for (int i = 0; i < args.Length; i++)
                {
                    if (i > 0)
                    {
                        name.Append(',');
                    }
                    name.Append(FormatType(args[i]));
                }
                name.Append(']');
                return name.ToString();
            }
            if (!string.IsNullOrEmpty(type.FullName))
            {
                return type.FullName;
            }
            return type.Name;
        }

        static string TypeFullName(Type type)
        {
            if (!string.IsNullOrEmpty(type.FullName))
            {
                return type.FullName;
            }
            if (!string.IsNullOrEmpty(type.Name))
            {
                return type.Name;
            }
            return type.ToString();
        }

        static string TypeKind(Type type)
        {
            if (type.IsEnum)
            {
                return "enum";
            }
            Type baseType = type.BaseType;
            if (baseType != null &&
                (baseType.FullName == "System.MulticastDelegate" || baseType.FullName == "System.Delegate"))
            {
                return "delegate";
            }
            if (type.IsInterface)
            {
                return "interface";
            }
            if (type.IsValueType)
            {
                return "struct";
            }
            if (type.IsAbstract && type.IsSealed)
            {
                return "static class";
            }
            if (type.IsAbstract)
            {
                return "abstract class";
            }
            return "class";
        }

        static string SanitizeMessage(string message)
        {
            if (string.IsNullOrEmpty(message))
            {
                return message ?? "";
            }
            string result = Regex.Replace(
                message,
                @"[A-Za-z]:\\(?:[^\\/:*?""<>|\r\n]+\\)*([^\\/:*?""<>|\r\n]+)",
                "$1");
            result = Regex.Replace(
                result,
                @"\\\\[^\\/:*?""<>|\r\n]+\\(?:[^\\/:*?""<>|\r\n]+\\)*([^\\/:*?""<>|\r\n]+)",
                "$1");
            return result;
        }

        static string EmptyToNull(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }
            return value.Trim();
        }

        static int CompareTypes(Type left, Type right)
        {
            return string.CompareOrdinal(TypeFullName(left), TypeFullName(right));
        }

        static int CompareMethods(MethodInfo left, MethodInfo right)
        {
            int name = string.CompareOrdinal(MethodDisplayName(left), MethodDisplayName(right));
            if (name != 0)
            {
                return name;
            }
            return string.CompareOrdinal(FormatType(left.ReturnType) + ParameterKey(left.GetParameters()), FormatType(right.ReturnType) + ParameterKey(right.GetParameters()));
        }

        static string ParameterKey(ParameterInfo[] parameters)
        {
            StringBuilder key = new StringBuilder();
            for (int i = 0; i < parameters.Length; i++)
            {
                key.Append('|');
                key.Append(ParameterDirection(parameters[i]));
                key.Append(' ');
                key.Append(FormatType(UnwrapByRef(parameters[i].ParameterType)));
            }
            return key.ToString();
        }

        static int CompareProperties(PropertyInfo left, PropertyInfo right)
        {
            return string.CompareOrdinal(left.Name, right.Name);
        }

        static int CompareEvents(EventInfo left, EventInfo right)
        {
            return string.CompareOrdinal(left.Name, right.Name);
        }

        static int CompareConstructors(ConstructorInfo left, ConstructorInfo right)
        {
            return string.CompareOrdinal(ParameterKey(left.GetParameters()), ParameterKey(right.GetParameters()));
        }

        static int CompareFields(FieldInfo left, FieldInfo right)
        {
            return string.CompareOrdinal(left.Name, right.Name);
        }

        static void WriteRawObjectArray(StringBuilder json, IList<string> objects)
        {
            json.Append('[');
            if (objects != null)
            {
                for (int i = 0; i < objects.Count; i++)
                {
                    if (i > 0)
                    {
                        json.Append(',');
                    }
                    json.Append(string.IsNullOrEmpty(objects[i]) ? "null" : objects[i]);
                }
            }
            json.Append(']');
        }

        static void WriteStringArray(StringBuilder json, IList<string> values)
        {
            json.Append('[');
            if (values != null)
            {
                for (int i = 0; i < values.Count; i++)
                {
                    if (i > 0)
                    {
                        json.Append(',');
                    }
                    WriteString(json, values[i]);
                }
            }
            json.Append(']');
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

        static void WriteLiteral(StringBuilder json, object value)
        {
            if (value == null)
            {
                json.Append("null");
                return;
            }
            if (value is bool)
            {
                json.Append((bool)value ? "true" : "false");
                return;
            }
            if (value is string)
            {
                WriteString(json, (string)value);
                return;
            }
            if (value is IFormattable)
            {
                json.Append(((IFormattable)value).ToString(null, CultureInfo.InvariantCulture));
                return;
            }
            WriteString(json, Convert.ToString(value, CultureInfo.InvariantCulture));
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
