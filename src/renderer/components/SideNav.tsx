import { Fragment, type ReactNode } from 'react'

export interface SideNavItem {
  id: string
  label: string
  hint?: string
  icon?: ReactNode
  /** 分组标题（PCL 左栏的分组标签） */
  section?: string
}

interface Props {
  items: SideNavItem[]
  value: string
  onChange: (id: string) => void
  emptyHint?: ReactNode
}

/** PCL 式左侧子导航（MyPageLeft + MyListItem 单选列表） */
export function SideNav({ items, value, onChange, emptyHint }: Props) {
  if (!items.length) {
    return (
      <aside className="side-nav">
        {emptyHint ?? <div className="side-empty">暂无可选项</div>}
      </aside>
    )
  }
  return (
    <aside className="side-nav">
      {items.map((item, index) => {
        const previous = items[index - 1]
        const showSection = item.section && item.section !== previous?.section
        return (
          <Fragment key={item.id}>
            {showSection && <div className="side-section">{item.section}</div>}
            <button
              className={`side-item ${value === item.id ? 'active' : ''}`}
              data-sub={item.id}
              onClick={() => onChange(item.id)}
            >
              {item.icon}
              <span className="side-item-main">
                <span className="side-item-title">{item.label}</span>
                {item.hint && <span className="side-item-hint">{item.hint}</span>}
              </span>
            </button>
          </Fragment>
        )
      })}
    </aside>
  )
}
