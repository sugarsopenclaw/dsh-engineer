/**
 * Generates an AC1015 (R2000) ASCII DXF exercising the entity classes that matter for
 * the probe: closed lightweight polylines, circles, Chinese single-line and multi-line
 * text, plain lines and several layers.
 *
 * R12-style DXF without handles and AcDb subclass markers parses into entities whose
 * geometry silently falls back to defaults, so the full R2000 skeleton (block records,
 * model/paper space blocks, owner back-references) is written out even though the
 * drawing itself is tiny.
 */

const LAYERS = [
  { name: '0', color: 7 },
  { name: 'WALL', color: 1 },
  { name: 'COLUMN', color: 3 },
  { name: 'TEXT', color: 2 },
  { name: 'GRID', color: 4 },
]

const MODEL_SPACE_RECORD = '1F'
const PAPER_SPACE_RECORD = '20'

let nextHandle = 0x100

function handle() {
  nextHandle += 1
  return nextHandle.toString(16).toUpperCase()
}

function pair(code, value) {
  return `${code}\n${value}\n`
}

function section(name, body) {
  return pair(0, 'SECTION') + pair(2, name) + body + pair(0, 'ENDSEC')
}

function header() {
  return section('HEADER',
    pair(9, '$ACADVER') + pair(1, 'AC1015')
    + pair(9, '$HANDSEED') + pair(5, 'FFFF')
    + pair(9, '$INSUNITS') + pair(70, 4)
    + pair(9, '$EXTMIN') + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0')
    + pair(9, '$EXTMAX') + pair(10, '23000.0') + pair(20, '14000.0') + pair(30, '0.0'))
}

function table(name, tableHandle, recordCount, records) {
  return pair(0, 'TABLE') + pair(2, name) + pair(5, tableHandle)
    + pair(100, 'AcDbSymbolTable') + pair(70, recordCount)
    + records
    + pair(0, 'ENDTAB')
}

function linetypeTable() {
  return table('LTYPE', '5F', 1,
    pair(0, 'LTYPE') + pair(5, '14') + pair(330, '5F')
    + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbLinetypeTableRecord')
    + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line')
    + pair(72, 65) + pair(73, 0) + pair(40, '0.0'))
}

function layerTable() {
  let records = ''
  for (const layer of LAYERS) {
    records += pair(0, 'LAYER') + pair(5, handle()) + pair(330, '2')
      + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbLayerTableRecord')
      + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color)
      + pair(6, 'CONTINUOUS') + pair(370, 25) + pair(390, 'F')
  }
  return table('LAYER', '2', LAYERS.length, records)
}

function styleTable() {
  return table('STYLE', '3', 1,
    pair(0, 'STYLE') + pair(5, '11') + pair(330, '3')
    + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbTextStyleTableRecord')
    + pair(2, 'Standard') + pair(70, 0) + pair(40, '0.0') + pair(41, '0.75')
    + pair(50, '0.0') + pair(71, 0) + pair(42, '2.5')
    + pair(3, 'gbenor.shx') + pair(4, 'gbcbig.shx'))
}

function blockRecordTable() {
  const record = (recordHandle, name) => pair(0, 'BLOCK_RECORD') + pair(5, recordHandle)
    + pair(330, '1') + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbBlockTableRecord')
    + pair(2, name) + pair(70, 0) + pair(280, 1) + pair(281, 0)
  return table('BLOCK_RECORD', '1', 2,
    record(MODEL_SPACE_RECORD, '*Model_Space') + record(PAPER_SPACE_RECORD, '*Paper_Space'))
}

function appidTable() {
  return table('APPID', '9', 1,
    pair(0, 'APPID') + pair(5, '12') + pair(330, '9')
    + pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbRegAppTableRecord')
    + pair(2, 'ACAD') + pair(70, 0))
}

function tables() {
  return section('TABLES',
    linetypeTable() + layerTable() + styleTable() + appidTable() + blockRecordTable())
}

function spaceBlock(name, recordHandle, isPaperSpace) {
  return pair(0, 'BLOCK') + pair(5, handle()) + pair(330, recordHandle)
    + pair(100, 'AcDbEntity') + pair(67, isPaperSpace ? 1 : 0) + pair(8, '0')
    + pair(100, 'AcDbBlockBegin') + pair(2, name) + pair(70, 0)
    + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0')
    + pair(3, name) + pair(1, '')
    + pair(0, 'ENDBLK') + pair(5, handle()) + pair(330, recordHandle)
    + pair(100, 'AcDbEntity') + pair(67, isPaperSpace ? 1 : 0) + pair(8, '0')
    + pair(100, 'AcDbBlockEnd')
}

function blocks() {
  return section('BLOCKS',
    spaceBlock('*Model_Space', MODEL_SPACE_RECORD, false)
    + spaceBlock('*Paper_Space', PAPER_SPACE_RECORD, true))
}

function entityHead(type, layer) {
  return pair(0, type) + pair(5, handle()) + pair(330, MODEL_SPACE_RECORD)
    + pair(100, 'AcDbEntity') + pair(8, layer)
}

function lwpolyline(layer, points, closed) {
  let output = entityHead('LWPOLYLINE', layer)
    + pair(100, 'AcDbPolyline') + pair(90, points.length) + pair(70, closed ? 1 : 0)
    + pair(43, '0.0')
  for (const [x, y] of points) {
    output += pair(10, x.toFixed(3)) + pair(20, y.toFixed(3))
  }
  return output
}

function line(layer, from, to) {
  return entityHead('LINE', layer) + pair(100, 'AcDbLine')
    + pair(10, from[0].toFixed(3)) + pair(20, from[1].toFixed(3)) + pair(30, '0.0')
    + pair(11, to[0].toFixed(3)) + pair(21, to[1].toFixed(3)) + pair(31, '0.0')
}

function circle(layer, center, radius) {
  return entityHead('CIRCLE', layer) + pair(100, 'AcDbCircle')
    + pair(10, center[0].toFixed(3)) + pair(20, center[1].toFixed(3)) + pair(30, '0.0')
    + pair(40, radius.toFixed(3))
}

function text(layer, position, height, value) {
  return entityHead('TEXT', layer) + pair(100, 'AcDbText')
    + pair(10, position[0].toFixed(3)) + pair(20, position[1].toFixed(3)) + pair(30, '0.0')
    + pair(40, height.toFixed(3)) + pair(1, value) + pair(50, '0.0')
    + pair(7, 'Standard') + pair(100, 'AcDbText') + pair(73, 0)
}

function mtext(layer, position, height, width, value) {
  return entityHead('MTEXT', layer) + pair(100, 'AcDbMText')
    + pair(10, position[0].toFixed(3)) + pair(20, position[1].toFixed(3)) + pair(30, '0.0')
    + pair(40, height.toFixed(3)) + pair(41, width.toFixed(3))
    + pair(71, 1) + pair(72, 1) + pair(1, value) + pair(7, 'Standard')
    + pair(50, '0.0') + pair(73, 1) + pair(44, '1.0')
}

function entities() {
  const roomLabels = ['办公室', '会议室', '设备间', '楼梯间', '卫生间', '资料室']
  let output = ''
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const x = 1_000 + column * 7_000
      const y = 1_000 + row * 6_500
      const width = 6_000
      const height = 5_500
      output += lwpolyline('WALL', [
        [x, y], [x + width, y], [x + width, y + height], [x, y + height],
      ], true)
      for (const [cx, cy] of [
        [x + 400, y + 400],
        [x + width - 400, y + 400],
        [x + 400, y + height - 400],
        [x + width - 400, y + height - 400],
      ]) {
        output += circle('COLUMN', [cx, cy], 250)
      }
      output += text('TEXT', [x + 700, y + height - 1_400], 400, roomLabels[row * 3 + column])
      output += text('TEXT', [x + 700, y + height - 2_200], 280, `${(width * height / 1e6).toFixed(2)} m2`)
      output += line('GRID', [x, y + height / 2], [x + width, y + height / 2])
    }
  }
  output += lwpolyline('0', [[0, 0], [23_000, 0], [23_000, 14_000], [0, 14_000]], true)
  output += mtext('TEXT', [800, 13_400], 500, 8_000, '晓量 MLightCAD 可行性验证图\\P标准层平面 1:100')
  return section('ENTITIES', output)
}

function objects() {
  return section('OBJECTS',
    pair(0, 'DICTIONARY') + pair(5, 'C') + pair(330, '0')
    + pair(100, 'AcDbDictionary') + pair(281, 1)
    + pair(3, 'ACAD_GROUP') + pair(350, 'D')
    + pair(0, 'DICTIONARY') + pair(5, 'D') + pair(330, 'C')
    + pair(100, 'AcDbDictionary') + pair(281, 1))
}

export function createProbeDxf() {
  nextHandle = 0x100
  return header() + tables() + blocks() + entities() + objects() + pair(0, 'EOF')
}
