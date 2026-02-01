全地域查询示例（实例列表）
==========================

目标：在未指定 Region 的情况下，默认查询所有地域的 Supabase 实例。

前置假设
--------
- 优先使用环境变量获取 AK/SK（`ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET`）。
- 如果 `ALICLOUD_REGION_ID` 未设置，走“全地域查询”策略。

策略建议
--------
1) 优先尝试在 RdsAi API 中查找地域列表接口（若后续文档补充）。  
2) 若无地域列表接口，则使用阿里云公开地域列表或由用户提供地域清单。  
3) 对每个地域调用 `DescribeAppInstances`，合并结果。  

伪代码
------

```
regions = resolve_regions()
all_instances = []
for region in regions:
  resp = DescribeAppInstances(RegionId=region, AppType="supabase")
  all_instances.extend(resp.Instances)
return all_instances
```

常见输出字段
-----------
- InstanceName
- Status
- AppName
- PublicConnectionString / VpcConnectionString
