using System;
using System.Globalization;
using System.IO;
using System.Text;
using Bricscad.EditorInput;
using Shb.Thcad.Extractor;
using Teigha.DatabaseServices;
using Teigha.Geometry;
using Teigha.Runtime;
using CoreApp = Bricscad.ApplicationServices.Application;

namespace Shb.Thcad.Probes
{
    public sealed class XuhaoCoordinateProbe
    {
        const string CommandName = "SHBPROBEXUHAO2";

        [CommandMethod(
            CommandName,
            CommandFlags.Modal | CommandFlags.UsePickSet | CommandFlags.Redraw)]
        public void Probe()
        {
            var document = CoreApp.DocumentManager.MdiActiveDocument;
            if (document == null)
            {
                return;
            }

            PromptSelectionResult selected = document.Editor.SelectImplied();
            if (selected.Status != PromptStatus.OK || selected.Value == null)
            {
                document.Editor.WriteMessage("\n" + CommandName + ": no preselection.\n");
                return;
            }

            ObjectId[] ids = selected.Value.GetObjectIds();
            var text = new StringBuilder();
            text.AppendLine("probe=xuhao_coordinate_interfaces");
            text.AppendLine("drawing=" + (document.Name ?? ""));
            text.AppendLine("selected_count=" + ids.Length.ToString(CultureInfo.InvariantCulture));

            try
            {
                using (Transaction transaction =
                    document.Database.TransactionManager.StartTransaction())
                {
                    foreach (ObjectId id in ids)
                    {
                        Entity entity = transaction.GetObject(
                            id,
                            OpenMode.ForRead,
                            false) as Entity;
                        if (entity == null)
                        {
                            continue;
                        }

                        text.AppendLine();
                        text.AppendLine("handle=" + entity.Handle.ToString());
                        text.AppendLine("runtime_class=" + entity.GetRXClass().Name);
                        XuhaoAnnotationCoordinates coordinates =
                            XuhaoAnnotationCoordinateExtractor.Extract(entity);
                        text.AppendLine(
                            "derived_pointing_position="
                            + (coordinates == null || !coordinates.PointingPoint.HasValue
                                ? "null"
                                : Point(coordinates.PointingPoint.Value)));
                        text.AppendLine(
                            "derived_number_position="
                            + (coordinates == null
                                ? "null"
                                : Point(coordinates.NumberPoint)));
                        ProbeExtents(entity, text);
                        ProbeLegacyGrips(entity, text);
                        ProbeModernGrips(entity, text);
                        ProbeStretchPoints(entity, text);
                        ProbeObjectSnaps(entity, text);
                        ProbeExplodeGeometry(entity, text);
                    }
                    transaction.Commit();
                }
            }
            catch (System.Exception ex)
            {
                text.AppendLine("probe_error=" + OneLine(ex));
            }
            finally
            {
                try
                {
                    document.Editor.SetImpliedSelection(ids);
                }
                catch
                {
                }
            }

            string outputPath = Path.Combine(
                Path.GetTempPath(),
                "shb-xuhao-coordinate-probe.txt");
            File.WriteAllText(outputPath, text.ToString(), Encoding.UTF8);
            document.Editor.WriteMessage("\n" + CommandName + " done: " + outputPath + "\n");
        }

        static void ProbeExtents(Entity entity, StringBuilder text)
        {
            try
            {
                Extents3d extents = entity.GeometricExtents;
                text.AppendLine("extents_min=" + Point(extents.MinPoint));
                text.AppendLine("extents_max=" + Point(extents.MaxPoint));
            }
            catch (System.Exception ex)
            {
                text.AppendLine("extents_error=" + OneLine(ex));
            }
        }

        static void ProbeLegacyGrips(Entity entity, StringBuilder text)
        {
            var points = new Point3dCollection();
            var osnapModes = new IntegerCollection();
            var geometryIds = new IntegerCollection();
            try
            {
                entity.GetGripPoints(points, osnapModes, geometryIds);
                AppendPoints(text, "legacy_grip", points);
            }
            catch (System.Exception ex)
            {
                text.AppendLine("legacy_grip_error=" + OneLine(ex));
            }
        }

        static void ProbeModernGrips(Entity entity, StringBuilder text)
        {
            using (var grips = new GripDataCollection())
            {
                try
                {
                    bool supported = entity.GetGripPoints(
                        grips,
                        1.0,
                        5,
                        Vector3d.ZAxis,
                        GetGripPointsFlags.GripPointsOnly);
                    text.AppendLine("modern_grip_supported=" + supported.ToString().ToLowerInvariant());
                    text.AppendLine("modern_grip_count=" + grips.Count.ToString(CultureInfo.InvariantCulture));
                    for (int index = 0; index < grips.Count; index++)
                    {
                        text.AppendLine(
                            "modern_grip[" + index.ToString(CultureInfo.InvariantCulture) + "]="
                            + Point(grips[index].GripPoint));
                    }
                }
                catch (System.Exception ex)
                {
                    text.AppendLine("modern_grip_error=" + OneLine(ex));
                }
            }
        }

        static void ProbeStretchPoints(Entity entity, StringBuilder text)
        {
            var points = new Point3dCollection();
            try
            {
                entity.GetStretchPoints(points);
                AppendPoints(text, "stretch", points);
            }
            catch (System.Exception ex)
            {
                text.AppendLine("stretch_error=" + OneLine(ex));
            }
        }

        static void ProbeObjectSnaps(Entity entity, StringBuilder text)
        {
            foreach (ObjectSnapModes mode in Enum.GetValues(typeof(ObjectSnapModes)))
            {
                var points = new Point3dCollection();
                var geometryIds = new IntegerCollection();
                try
                {
                    entity.GetObjectSnapPoints(
                        mode,
                        0,
                        Point3d.Origin,
                        Point3d.Origin,
                        Matrix3d.Identity,
                        points,
                        geometryIds);
                    if (points.Count > 0)
                    {
                        AppendPoints(text, "osnap_" + mode, points);
                    }
                }
                catch (System.Exception ex)
                {
                    text.AppendLine("osnap_" + mode + "_error=" + OneLine(ex));
                }
            }
        }

        static void ProbeExplodeGeometry(Entity entity, StringBuilder text)
        {
            var children = new DBObjectCollection();
            try
            {
                entity.ExplodeGeometry(children);
                text.AppendLine("explode_geometry_count=" + children.Count.ToString(CultureInfo.InvariantCulture));
                int index = 0;
                foreach (DBObject child in children)
                {
                    try
                    {
                        var childEntity = child as Entity;
                        text.AppendLine(
                            "explode_geometry[" + index.ToString(CultureInfo.InvariantCulture) + "].type="
                            + (childEntity == null ? child.GetType().Name : childEntity.GetRXClass().Name));
                        if (childEntity != null)
                        {
                            try
                            {
                                Extents3d extents = childEntity.GeometricExtents;
                                text.AppendLine(
                                    "explode_geometry[" + index.ToString(CultureInfo.InvariantCulture)
                                    + "].extents=" + Point(extents.MinPoint) + " -> " + Point(extents.MaxPoint));
                            }
                            catch
                            {
                            }
                        }
                    }
                    finally
                    {
                        child.Dispose();
                    }
                    index++;
                }
            }
            catch (System.Exception ex)
            {
                text.AppendLine("explode_geometry_error=" + OneLine(ex));
            }
        }

        static void AppendPoints(
            StringBuilder text,
            string prefix,
            Point3dCollection points)
        {
            text.AppendLine(prefix + "_count=" + points.Count.ToString(CultureInfo.InvariantCulture));
            for (int index = 0; index < points.Count; index++)
            {
                text.AppendLine(
                    prefix + "[" + index.ToString(CultureInfo.InvariantCulture) + "]="
                    + Point(points[index]));
            }
        }

        static string Point(Point3d point)
        {
            return point.X.ToString("R", CultureInfo.InvariantCulture)
                + ","
                + point.Y.ToString("R", CultureInfo.InvariantCulture)
                + ","
                + point.Z.ToString("R", CultureInfo.InvariantCulture);
        }

        static string OneLine(System.Exception ex)
        {
            return (ex.GetType().Name + ": " + ex.Message)
                .Replace('\r', ' ')
                .Replace('\n', ' ');
        }
    }
}
