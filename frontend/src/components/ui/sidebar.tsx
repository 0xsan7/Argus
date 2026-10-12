import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react'

type SidebarContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('Sidebar components must be used inside SidebarProvider.')
  return context
}

export function SidebarProvider({ children, defaultOpen = true }: { children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <SidebarContext.Provider value={{ open, setOpen, mobileOpen, setMobileOpen }}>
      <div className="app-shell" data-sidebar-open={open} style={{ '--sidebar-width': open ? '196px' : '68px' } as CSSProperties}>
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export function Sidebar({ children, className = '', label = 'Application navigation' }: { children: ReactNode; className?: string; label?: string }) {
  const { setOpen } = useSidebar()
  return (
    <aside
      className={`sidebar ${className}`.trim()}
      aria-label={label}
      onMouseEnter={() => { if (window.innerWidth > 800) setOpen(true) }}
      onMouseLeave={() => { if (window.innerWidth > 800) setOpen(false) }}
    >
      <SidebarBody>{children}</SidebarBody>
      <MobileSidebar>{children}</MobileSidebar>
    </aside>
  )
}

export function SidebarBody({ children }: { children: ReactNode }) {
  return <div className="sidebar-desktop-content">{children}</div>
}

export function MobileSidebar({ children }: { children: ReactNode }) {
  const { mobileOpen, setMobileOpen } = useSidebar()
  return (
    <div className="sidebar-mobile">
      <span className="sidebar-mobile-brand">ARGUS<small>NETWORK OBSERVATORY</small></span>
      <button
        type="button"
        className="sidebar-menu-button"
        aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        <span aria-hidden="true">{mobileOpen ? '×' : '☰'}</span>
      </button>
      {mobileOpen && (
        <div className="sidebar-mobile-overlay">
          <button type="button" className="sidebar-mobile-backdrop" aria-label="Close navigation menu" onClick={() => setMobileOpen(false)} />
          <div className="sidebar-mobile-drawer">
            <button type="button" className="sidebar-mobile-close" aria-label="Close navigation menu" onClick={() => setMobileOpen(false)}>×</button>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

export function SidebarLink({
  link,
  active = false,
  onNavigate,
}: {
  link: { label: string; href: '/' | '/models' | '/about'; icon: ReactNode }
  active?: boolean
  onNavigate: (href: '/' | '/models' | '/about') => void
}) {
  const { setMobileOpen } = useSidebar()
  return (
    <a
      className={`nav-item${active ? ' active' : ''}`}
      href={link.href}
      aria-current={active ? 'page' : undefined}
      title={link.label}
      onClick={event => {
        event.preventDefault()
        onNavigate(link.href)
        if (window.innerWidth <= 800) setMobileOpen(false)
      }}
    >
      {link.icon}<span className="nav-link-label">{link.label}</span>{active && <span className="nav-dot" />}
    </a>
  )
}
