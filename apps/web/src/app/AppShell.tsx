import { LogOut, Moon, ShieldCheck, Sun } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/misc';
import { useSession } from '@/features/auth/session';
import { useTheme } from '@/lib/theme';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, logout } = useSession();
  const { theme, toggle } = useTheme();
  const user = session!.user;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-tight">
              <p className="text-[15px] font-semibold tracking-tight">Acme Credit</p>
              <p className="text-xs text-muted">
                {user.role === 'ops' ? 'Operations console' : 'Secured card'}
              </p>
            </div>
            {user.role === 'ops' && (
              <Badge tone="brand" className="ml-2 hidden sm:inline-flex">
                <ShieldCheck className="size-3" /> Ops
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Tip content={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
                {theme === 'dark' ? <Sun /> : <Moon />}
              </Button>
            </Tip>
            <div className="mx-1.5 hidden h-6 w-px bg-border sm:block" />
            <div className="hidden items-center gap-2.5 sm:flex">
              <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-info/80 text-xs font-semibold text-white">
                {initials}
              </div>
              <div className="leading-tight">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted">{user.email}</p>
              </div>
            </div>
            <Tip content="Sign out">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void logout()}
                aria-label="Sign out"
              >
                <LogOut />
              </Button>
            </Tip>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
