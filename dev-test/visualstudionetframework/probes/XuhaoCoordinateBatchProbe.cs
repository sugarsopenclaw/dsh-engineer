using System;
using System.Globalization;
using System.IO;
using System.Text;
using Shb.Thcad.Extractor;
using Teigha.DatabaseServices;
using Teigha.Runtime;
using CoreApp = Bricscad.ApplicationServices.Application;

namespace Shb.Thcad.Probes
{
    public sealed class XuhaoCoordinateBatchProbe
    {
        [CommandMethod("SHBPROBEXUHAOALL3", CommandFlags.Session)]
        public void ProbeAllDrawings()
        {
            var document = CoreApp.DocumentManager.MdiActiveDocument;
            if (document == null || string.IsNullOrWhiteSpace(document.Name))
            {
                return;
            }

            string sourceDirectory = Path.GetDirectoryName(document.Name);
            string[] files = Directory.GetFiles(sourceDirectory, "*.dwg");
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);

            var output = new StringBuilder();
            output.AppendLine("probe=xuhao_coordinate_batch");
            output.AppendLine("source_directory=" + sourceDirectory);
            int allEntities = 0;
            int allNumberPositions = 0;
            int allPointingPositions = 0;

            foreach (string path in files)
            {
                int entityCount = 0;
                int numberPositionCount = 0;
                int pointingPositionCount = 0;
                var missingNumberHandles = new StringBuilder();
                var missingPointingHandles = new StringBuilder();
                var missingDetails = new StringBuilder();
                using (var database = new Database(false, true))
                {
                    database.ReadDwgFile(
                        path,
                        FileOpenMode.OpenForReadAndAllShare,
                        false,
                        "");
                    database.CloseInput(true);
                    using (Transaction transaction =
                        database.TransactionManager.StartTransaction())
                    {
                        var blocks = (BlockTable)transaction.GetObject(
                            database.BlockTableId,
                            OpenMode.ForRead);
                        foreach (ObjectId blockId in blocks)
                        {
                            var block = (BlockTableRecord)transaction.GetObject(
                                blockId,
                                OpenMode.ForRead);
                            foreach (ObjectId entityId in block)
                            {
                                var entity = transaction.GetObject(
                                    entityId,
                                    OpenMode.ForRead,
                                    false) as Entity;
                                if (entity == null
                                    || !string.Equals(
                                        entity.GetRXClass().Name,
                                        "TH_XuHaoEntity",
                                        StringComparison.Ordinal))
                                {
                                    continue;
                                }

                                entityCount++;
                                XuhaoAnnotationCoordinates coordinates =
                                    XuhaoAnnotationCoordinateExtractor.Extract(entity);
                                if (coordinates == null
                                    || coordinates.NumberPosition == null)
                                {
                                    if (missingNumberHandles.Length > 0)
                                    {
                                        missingNumberHandles.Append(',');
                                    }
                                    missingNumberHandles.Append(entity.Handle.ToString());
                                }
                                else
                                {
                                    numberPositionCount++;
                                }

                                if (coordinates == null
                                    || coordinates.PointingPosition == null)
                                {
                                    if (missingPointingHandles.Length > 0)
                                    {
                                        missingPointingHandles.Append(',');
                                    }
                                    missingPointingHandles.Append(entity.Handle.ToString());
                                    missingDetails.AppendLine(
                                        "no_pointing_geometry "
                                        + Path.GetFileNameWithoutExtension(path)
                                        + " "
                                        + entity.Handle.ToString()
                                        + " "
                                        + DescribeGeometry(entity));
                                }
                                else
                                {
                                    pointingPositionCount++;
                                }
                            }
                        }
                        transaction.Commit();
                    }
                }

                allEntities += entityCount;
                allNumberPositions += numberPositionCount;
                allPointingPositions += pointingPositionCount;
                output.AppendLine(
                    Path.GetFileNameWithoutExtension(path)
                    + " number="
                    + numberPositionCount.ToString(CultureInfo.InvariantCulture)
                    + "/"
                    + entityCount.ToString(CultureInfo.InvariantCulture)
                    + " pointing="
                    + pointingPositionCount.ToString(CultureInfo.InvariantCulture)
                    + "/"
                    + entityCount.ToString(CultureInfo.InvariantCulture)
                    + (missingNumberHandles.Length == 0
                        ? ""
                        : " missing_number=" + missingNumberHandles)
                    + (missingPointingHandles.Length == 0
                        ? ""
                        : " no_pointing=" + missingPointingHandles));
                output.Append(missingDetails);
            }

            output.AppendLine(
                "total number="
                + allNumberPositions.ToString(CultureInfo.InvariantCulture)
                + "/"
                + allEntities.ToString(CultureInfo.InvariantCulture)
                + " pointing="
                + allPointingPositions.ToString(CultureInfo.InvariantCulture)
                + "/"
                + allEntities.ToString(CultureInfo.InvariantCulture));
            string outputPath = Path.Combine(
                Path.GetTempPath(),
                "shb-xuhao-coordinate-batch-probe.txt");
            File.WriteAllText(outputPath, output.ToString(), Encoding.UTF8);
            document.Editor.WriteMessage(
                "\nSHBPROBEXUHAOALL3 done: " + outputPath + "\n");
        }

        static string DescribeGeometry(Entity entity)
        {
            var parts = new DBObjectCollection();
            var description = new StringBuilder();
            try
            {
                entity.ExplodeGeometry(parts);
                foreach (DBObject part in parts)
                {
                    var circle = part as Circle;
                    if (circle != null)
                    {
                        description.AppendFormat(
                            CultureInfo.InvariantCulture,
                            "C({0:R},{1:R},r={2:R}) ",
                            circle.Center.X,
                            circle.Center.Y,
                            circle.Radius);
                        continue;
                    }
                    var line = part as Line;
                    if (line != null)
                    {
                        description.AppendFormat(
                            CultureInfo.InvariantCulture,
                            "L({0:R},{1:R}->{2:R},{3:R}) ",
                            line.StartPoint.X,
                            line.StartPoint.Y,
                            line.EndPoint.X,
                            line.EndPoint.Y);
                        continue;
                    }
                    description.Append(part.GetRXClass().Name).Append(' ');
                }
            }
            catch (System.Exception ex)
            {
                description.Append("error=").Append(ex.Message);
            }
            finally
            {
                foreach (DBObject part in parts)
                {
                    if (part != null)
                    {
                        part.Dispose();
                    }
                }
            }
            return description.ToString().Trim();
        }
    }
}
