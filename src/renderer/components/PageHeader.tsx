import type { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  actions?: ReactNode
}

/** PCL 页面标题行：左侧标题 + 副标题，右侧操作按钮 */
export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
