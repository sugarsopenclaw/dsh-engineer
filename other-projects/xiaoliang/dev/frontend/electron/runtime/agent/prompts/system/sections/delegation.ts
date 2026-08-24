import { isSubagentInteractiveEnabled } from '../../../subagents/feature-flags'

export function buildDelegationSection(toolNames: string[] = []) {
  const hasCadDelegate = toolNames.includes('delegate_cad')
  const hasCadDrafterDelegate = toolNames.includes('delegate_cad_drafter')
  const hasBlenderDelegate = toolNames.includes('delegate_blender')
  const hasCadEvidenceImage = toolNames.includes('cad_evidence_image')
  const hasBackgroundTasks = toolNames.includes('subagent_task_status')
  const interactive = hasBackgroundTasks && isSubagentInteractiveEnabled()

  const lines = [
    '当前是统一对话入口，没有需要用户切换的模式。先判断任务意图，再自动选择项目资料检索、联网、CAD 取证、构件算法或 Blender 子代理；不得要求用户切换模式，也不要提议恢复已移除的旧设计画布或浏览器三维工作台。',
  ]

  if (hasCadDelegate) {
    lines.push(
      '涉及 DWG/DXF、CAD 图纸内容、实体、尺寸、标高、做法、定位或图纸驱动算量时，默认直接调用 delegate_cad：task 写清构件/区域或编号、所需权威字段与用户限制，并原样保留“快速/只看/先汇报”等速度和范围约束。编号明确的单构件快速问题不得扩写成轴线、全部实例、基础表、所有材料与截图清单；例如“看 DJP13 的尺寸和做法，快速”只委派该编号的尺寸与直接关联做法，并注明走 `extract → 精确 search → detail` 快路径。用户未指定其他图纸时优先 cad_session 的当前活动图；活动图未知或未映射也直接委派，由 child 用 cad_app status/list 自判，不得先枚举项目目录或按文件名猜图。只有用户明确要求列图、指定/搜索路径或跨多图检索时，才先用项目文件工具。',
      hasCadEvidenceImage
        ? '主 Agent 不得直接连接或驾驶 AutoCAD，也不得要求用户手选实体、缩放、截图或点击旧预处理入口。cad-analyst 只取证不下结论；delegate_cad 完成后必须先 read canonical evidence.md，再用 cad_evidence_image 检查其中引用的图片，然后由主 Agent 形成结论。消费细则见[工具边界]。'
        : '主 Agent 不得直接连接或驾驶 AutoCAD，也不得要求用户手选实体、缩放、截图或点击旧预处理入口。cad-analyst 只取证不下结论；delegate_cad 完成后按[工具边界]的证据消费方式读取 evidence.md 与相关图片，最终结论由主 Agent 形成。',
    )
  } else {
    lines.push(
      '当前没有可用的 CAD 取证子代理。若任务依赖新的 DWG/CAD 事实，应明确说明项目目录或 CAD 自动化尚未就绪；不得回退到旧手动 CAD 通道。',
    )
  }

  if (hasCadDrafterDelegate) {
    lines.push(
      hasCadDelegate
        ? '两条 CAD 取证通道按证据类型分工，可同时进行：delegate_cad 是 AutoCAD 权威通道（同时只跑一个），delegate_cad_drafter 是文件通道（直接解析图纸文件、不占用 AutoCAD、可并发多个）。线框表格类图纸整表转录、区域扫图、文字与编号定位、图层清单优先派 delegate_cad_drafter；精确净尺寸量测、OLE/Excel 嵌入表、嵌套块内部几何、权威 handle 字段、图框检测与宏观识图必须派 delegate_cad。task 写清图纸项目相对路径与所需字段。'
        : '涉及 DWG/DXF 图纸内容时调用 delegate_cad_drafter，task 写清图纸项目相对路径与所需字段。',
      '每次委派只针对一个目标：多目标混在同一个 task 里，child 常在取够证据后收尾失败，整单证据白跑。多张图纸或多个构件拆成多次委派，文件通道任务之间可并发，权威通道排队执行。',
      '工程证据预检需要项目名称、建设地点、建设类型、专业或专项特征时，把“项目身份与适用范围元数据”视为一个目标；已知图纸路径时优先用文件通道读图签/标题栏/设计总说明，不可读字段再派 AutoCAD 权威通道。只回报实际检查的图纸名与逐字字段，不按文件名推断。',
    )
  }

  if (hasBlenderDelegate) {
    lines.push(
      '涉及三维建模、修改 Blender 场景、对象/材质/镜头处理或视口自检时，自动调用 delegate_blender；主 Agent 不直接持有 Blender MCP 或任意 Blender Python 工具。child 不继承父对话：task 必须写清目标对象、已知几何参数、必须保留的内容和验收条件，关键工程参数缺失时不得让 child 猜测。',
    )
  }

  if (hasCadDelegate && hasBlenderDelegate) {
    lines.push(
      interactive
        ? '用户要求根据 CAD 建模时严格串行：delegate_cad 取证 → 读取并核验 evidence.md/相关图片 → 把已核验尺寸、形态、来源与未决项整理成自包含任务 → delegate_blender 建模并截图自检。这条链路跨回合执行：委派取证后结束本轮，终态注入后再委派建模；取证终态到达前不得为同一链路派 Blender 子代理，也不得让 Blender 子代理自行读取 CAD。'
        : '用户要求根据 CAD 建模时严格串行：delegate_cad 取证 → 读取并核验 evidence.md/相关图片 → 把已核验尺寸、形态、来源与未决项整理成自包含任务 → delegate_blender 建模并截图自检。取证终态到达前不得为同一链路派 Blender 子代理，也不得让 Blender 子代理自行读取 CAD。',
      '串行只约束依赖 CAD 证据的建模链路；与在跑取证无关的 Blender 任务立即 delegate_blender，两类子代理各自独立排队，不得因 CAD child 在跑而推迟或只在口头上声称已委派。',
    )
  }

  if (interactive) {
    lines.push(
      '委派返回 taskId 只代表后台任务已登记。默认用一两句话告知用户已派出什么任务（可含 taskId 和排队位次），然后结束本回合，把对话交还给用户；完成后 host 注入安全终态并唤醒你，不需要守着等。',
      '如果已经规划出多个互不依赖的 CAD 或 Blender 子任务，先在同一回合把所有独立委派逐项登记，再统一告知并结束；不要因第一项返回 taskId 就漏派其余任务。存在依赖关系的任务仍等待前置证据后再派。',
      '只有两种情况才用 subagent_task_status({taskIds:[taskId], timeoutMs:600000}) 阻塞等待：用户明确要求等到出结果，或任务确定很快结束且本轮还要用其结果。等待被用户新消息提前打断时返回 yielded=user_message：任务仍在后台运行，先回应用户，不要重新进入等待。阻塞等待已消费的终态不会再次注入。',
    )
  } else if (hasBackgroundTasks) {
    lines.push(
      '委派返回 taskId 只代表后台任务已登记。没有其他独立工作可做时，立刻调用 subagent_task_status({taskIds:[taskId], timeoutMs:600000}) 等待安全终态；有独立工作时先推进，再查询。阻塞等待已消费的终态不会再次注入。',
      '如果已经规划出多个互不依赖的 CAD 或 Blender 子任务，先把所有独立委派逐项登记，再一次等待这些 taskId；存在依赖关系的任务仍按顺序执行。',
    )
  }

  return lines.join('\n')
}
