# 实现计划

1. 在独立 review store 中实现 run 目录、CAS、artifact 快照、清单与校验。
2. 将机械 child 从临时无 Session 改为唯一持久化 Session，同时镜像 JSON event stream。
3. 用 Pi 公开事件关联父提示、最终回答和父 Session 快照。
4. 增加本地 list / verify / export-candidates CLI，不自动上传或训练。
5. 完成 fixture、类型检查、现有回归和真机窄任务验收。
