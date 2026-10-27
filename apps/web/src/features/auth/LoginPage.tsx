import { ArrowRight, Lock, ShieldCheck, Sparkles, UserPlus, Zap } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSession } from './session';

const DEMO_USERS = [
  {
    email: 'alice@acme.test',
    name: 'Alice Customer',
    role: 'Customer',
    tone: 'from-indigo-500 to-sky-500',
  },
  {
    email: 'bob@acme.test',
    name: 'Bob Customer',
    role: 'Customer',
    tone: 'from-fuchsia-500 to-orange-400',
  },
  {
    email: 'ops@acme.test',
    name: 'Olivia Ops',
    role: 'Operations',
    tone: 'from-emerald-500 to-teal-500',
  },
];

const FEATURES = [
  {
    icon: Lock,
    title: 'Backed by your deposit',
    text: 'Your limit is your collateral. No credit check.',
  },
  { icon: Zap, title: 'Instant card', text: 'Virtual card activates the moment funds clear.' },
  {
    icon: ShieldCheck,
    title: 'Every cent accounted for',
    text: 'Double-entry ledger, audited and reconciled.',
  },
];

export function LoginPage() {
  const { demoLogin, register } = useSession();
  const [pending, setPending] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  async function run(id: string, fn: () => Promise<unknown>) {
    setPending(id);
    try {
      await fn();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0b0d1a] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-32 -top-32 size-[520px] rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 size-[480px] rounded-full bg-sky-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Acme Credit</span>
        </div>
        <div className="relative my-auto max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
            <Sparkles className="size-3.5" /> Secured credit, done right
          </p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
            Build credit with a card backed by{' '}
            <span className="bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">
              your own money.
            </span>
          </h1>
          <ul className="mt-10 space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-5" />
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-white/60">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">
          Demo environment. Payments and card network are simulated.
        </p>
      </aside>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo />
            <span className="text-lg font-semibold">Acme Credit</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted">
            Pick a demo identity. Sign-in is passwordless against a simulated identity provider.
          </p>

          <div className="mt-6 space-y-2.5">
            {DEMO_USERS.map((user) => (
              <button
                key={user.email}
                onClick={() => run(user.email, () => demoLogin(user.email))}
                disabled={pending !== null}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left shadow-xs transition hover:border-brand/50 hover:shadow-md disabled:opacity-60',
                  pending === user.email && 'border-brand/60',
                )}
              >
                <div
                  className={cn(
                    'grid size-10 place-items-center rounded-full bg-gradient-to-br text-sm font-semibold text-white',
                    user.tone,
                  )}
                >
                  {user.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted">
                    {user.role} · {user.email}
                  </p>
                </div>
                <ArrowRight className="size-4 text-subtle transition group-hover:translate-x-0.5 group-hover:text-brand" />
              </button>
            ))}
          </div>

          <div className="my-7 flex items-center gap-3 text-xs text-subtle">
            <div className="h-px flex-1 bg-border" /> or create a customer{' '}
            <div className="h-px flex-1 bg-border" />
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run('register', () => register(email.trim(), name.trim()));
            }}
          >
            <Field label="Full name" htmlFor="name">
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Carol Customer"
                required
                maxLength={120}
              />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="carol@example.com"
                required
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={pending === 'register'}
              disabled={pending !== null}
            >
              <UserPlus /> Create account
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
