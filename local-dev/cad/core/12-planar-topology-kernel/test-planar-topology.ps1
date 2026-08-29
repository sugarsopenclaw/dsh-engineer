$ErrorActionPreference = 'Stop'

$files = @(
    (Join-Path $PSScriptRoot '../11-block-instance-coordinate-facts/BlockInstanceCoordinateAnalyzer.cs'),
    (Join-Path $PSScriptRoot 'PlanarTopologyAnalyzer.cs')
)
Add-Type -Path $files

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERT TRUE failed: $Message" }
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -ne $Actual) {
        throw "ASSERT EQUAL failed: $Message; expected=[$Expected], actual=[$Actual]"
    }
}

function Assert-Near([double]$Expected, [double]$Actual, [double]$Tolerance, [string]$Message) {
    if ([Math]::Abs($Expected - $Actual) -gt $Tolerance) {
        throw "ASSERT NEAR failed: $Message; expected=[$Expected], actual=[$Actual]"
    }
}

function New-PointList([object[]]$Coordinates) {
    $result = [System.Collections.Generic.List[Shb.Cad.Core.InstancePoint3Observation]]::new()
    foreach ($coordinate in $Coordinates) {
        $result.Add([Shb.Cad.Core.InstancePoint3Observation]::new(
            [double]$coordinate[0], [double]$coordinate[1], 0))
    }
    return ,$result
}

function New-Topology([object[]]$Paths) {
    $drawing = [Shb.Cad.Core.InstanceDrawingObservation]::new('synthetic-topology')
    $drawing.AddLayer([Shb.Cad.Core.InstanceLayerObservation]::new(
        '0', [Shb.Cad.Core.InstanceColorObservation]::new('explicit', 'white', 7, $null, $null, $null),
        'Continuous', 25, $false, $false)) | Out-Null
    $root = [Shb.Cad.Core.InstanceDefinitionObservation]::new(
        'ROOT', '*MODEL_SPACE', 'model_space', $true, $false, $false)
    $roles = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    $index = 0
    foreach ($path in $Paths) {
        $handle = "E$index"
        $entity = [Shb.Cad.Core.InstanceEntityObservation]::new(
            $handle, 'AcDbPolyline', 'Polyline', 'path', '0', $true)
        $quality = if ($path.Quality) { [string]$path.Quality } else { 'exact_linear_polyline' }
        $entity.SetPath((New-PointList $path.Points), [bool]$path.Closed, $quality) | Out-Null
        $root.AddEntity($entity) | Out-Null
        $roles[$handle] = $(if ($path.Role) { [string]$path.Role } else { 'visible_contour' })
        $index++
    }
    $drawing.AddDefinition($root) | Out-Null
    $instances = [Shb.Cad.Core.BlockInstanceCoordinateAnalyzer]::Analyze($drawing, $roles)
    return [Shb.Cad.Core.PlanarTopologyAnalyzer]::Analyze($instances)
}

$square = New-Topology @(
    [pscustomobject]@{ Points = @(@(0,0), @(10,0), @(10,10), @(0,10)); Closed = $true }
)
Assert-Equal 'computed' $square.Status 'simple square status'
Assert-Equal 4 $square.Vertices.Count 'square vertices'
Assert-Equal 4 $square.Edges.Count 'square edges'
Assert-Equal 1 $square.Faces.Count 'square bounded face'
Assert-Near 100 $square.Faces[0].NetArea 0.000001 'square area'
Assert-True (@($square.Validations | Where-Object { -not $_.Passed }).Count -eq 0) 'all square DCEL validations'

$crossing = New-Topology @(
    [pscustomobject]@{ Points = @(@(-5,0), @(5,0)); Closed = $false },
    [pscustomobject]@{ Points = @(@(0,-5), @(0,5)); Closed = $false }
)
Assert-Equal 5 $crossing.Vertices.Count 'proper crossing creates center node'
Assert-Equal 4 $crossing.Edges.Count 'both source segments split at crossing'
Assert-Equal 1 $crossing.IntersectionCount 'proper crossing count'
Assert-Equal 4 (@($crossing.Vertices | Where-Object Degree -eq 1)).Count 'four endpoints'
Assert-Equal 1 (@($crossing.Vertices | Where-Object Degree -eq 4)).Count 'degree-4 intersection'

$overlap = New-Topology @(
    [pscustomobject]@{ Points = @(@(0,0), @(10,0)); Closed = $false },
    [pscustomobject]@{ Points = @(@(5,0), @(15,0)); Closed = $false }
)
Assert-Equal 4 $overlap.Vertices.Count 'overlap endpoints become nodes'
Assert-Equal 3 $overlap.Edges.Count 'overlap canonical fragments'
Assert-Equal 1 $overlap.CollinearOverlapCount 'overlap relation detected'
Assert-Equal 1 (@($overlap.Edges | Where-Object HasCoincidentSupport)).Count 'middle edge retains two source supports'
Assert-Equal 2 (@($overlap.Edges | Where-Object HasCoincidentSupport)[0].Supports).Count 'support multiplicity'

$tJunction = New-Topology @(
    [pscustomobject]@{ Points = @(@(0,0), @(10,0)); Closed = $false },
    [pscustomobject]@{ Points = @(@(5,0.03), @(5,5)); Closed = $false }
)
Assert-Equal 4 $tJunction.Vertices.Count 'near T endpoint snaps to segment interior'
Assert-Equal 3 $tJunction.Edges.Count 'T target segment split'
Assert-Equal 1 (@($tJunction.SnapClusters | Where-Object TargetKind -eq 'segment_projection')).Count `
    'non-mutating endpoint-to-edge snap plan recorded'
Assert-Near 0 (@($tJunction.Vertices | Sort-Object { [Math]::Abs($_.X-5)+[Math]::Abs($_.Y) } | Select-Object -First 1).Y) `
    0.000001 'T node projected onto host segment'

$nested = New-Topology @(
    [pscustomobject]@{ Points = @(@(0,0), @(10,0), @(10,10), @(0,10)); Closed = $true },
    [pscustomobject]@{ Points = @(@(3,3), @(7,3), @(7,7), @(3,7)); Closed = $true }
)
Assert-Equal 2 $nested.Components.Count 'disconnected nested rings remain separate graph components'
Assert-Equal 2 $nested.Faces.Count 'inner face and outer annular face'
$areas = @($nested.Faces | ForEach-Object NetArea | Sort-Object)
Assert-Near 16 $areas[0] 0.000001 'inner face area'
Assert-Near 84 $areas[1] 0.000001 'outer face subtracts direct child hole'
Assert-True (@($nested.Validations | Where-Object { -not $_.Passed }).Count -eq 0) 'nested Euler/DCEL validations'

$excluded = New-Topology @(
    [pscustomobject]@{ Points = @(@(0,0), @(10,0)); Closed = $false; Role = 'annotation_geometry' }
)
Assert-Equal 0 $excluded.InputSegmentCount 'annotation role excluded from structural topology by default'

$denseSamples = @()
for ($sampleIndex = 0; $sampleIndex -le 100; $sampleIndex++) {
    $denseSamples += ,@(($sampleIndex * 0.01), 0)
}
$sampledCurve = New-Topology @(
    [pscustomobject]@{
        Points = $denseSamples
        Closed = $false
        Quality = 'adaptive_parameter_tessellation_spline'
    }
)
Assert-Equal 100 $sampledCurve.Edges.Count 'nearby tessellation nodes are not tolerance-snapped together'
Assert-Equal 0 (@($sampledCurve.Diagnostics | Where-Object Code -eq 'SNAP_COLLAPSED_SOURCE_SEGMENT')).Count `
    'adaptive internal samples never become endpoint snap candidates'

$shortEdge = New-Topology @(
    [pscustomobject]@{ Points = @(@(0,0), @(0.04,0)); Closed = $false },
    [pscustomobject]@{ Points = @(@(0.02,0), @(0.02,1)); Closed = $false }
)
Assert-Equal 3 $shortEdge.Edges.Count 'authored short edge survives and remains noded by the crossing'
Assert-Equal 1 (@($shortEdge.Diagnostics | Where-Object Code -eq 'SNAP_REJECTED_TO_PRESERVE_SOURCE_EDGE')).Count `
    'collapse-producing snap is rejected with explicit evidence'
Assert-Equal 0 (@($shortEdge.Diagnostics | Where-Object Code -eq 'SNAP_COLLAPSED_SOURCE_SEGMENT')).Count `
    'rejected snap never silently removes the source edge'

# Optional regression over outputs produced by the THCAD adapter.
$outRoot = Resolve-Path (Join-Path $PSScriptRoot '../../../../dev-test/visualstudionetframework/out-thcad')
$regressionFiles = @(Get-ChildItem $outRoot -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'planar-topology.json' } |
    Where-Object { Test-Path $_ })
foreach ($file in $regressionFiles) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    Assert-Equal ($json.edge_count * 2) $json.halfedge_count "halfedge invariant: $file"
    Assert-Equal 'read_only_no_entities_modified' $json.mutation_status "read-only contract: $file"
    Assert-True (@($json.validations | Where-Object { -not $_.passed }).Count -eq 0) "DCEL validations: $file"
}

Write-Host "PASS 12 planar-topology-kernel; optional THCAD regressions=$($regressionFiles.Count)"
