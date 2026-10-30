import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

/** Seeded locally only (see the API's seed). Hidden in deployed builds. */
const DEMO_PASSWORD = 'acme-demo-password';
const SHOW_DEMO_ACCOUNTS = import.meta.env.VITE_HIDE_DEMO_ACCOUNTS !== 'true';
const PASSWORD_MIN_LENGTH = 12;

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
  const { login, register } = useSession();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [pending, setPending] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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

  const tooShort =
    mode === 'register' && password.length > 0 && password.length < PASSWORD_MIN_LENGTH;

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
          <h2 className="text-2xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {mode === 'signin'
              ? 'Sign in with your email and password.'
              : 'Open a secured card in minutes. No credit check.'}
          </p>

          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="register">Create account</TabsTrigger>
            </TabsList>
          </Tabs>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(mode, () =>
                mode === 'signin'
                  ? login(email.trim(), password)
                  : register(email.trim(), name.trim(), password),
              );
            }}
          >
            {mode === 'register' && (
              <Field label="Full name" htmlFor="name">
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Carol Customer"
                  autoComplete="name"
                  required
                  maxLength={120}
                />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="carol@example.com"
                autoComplete="email"
                required
              />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              error={tooShort ? `At least ${PASSWORD_MIN_LENGTH} characters` : null}
              hint={
                mode === 'register'
                  ? `At least ${PASSWORD_MIN_LENGTH} characters. A passphrase works well.`
                  : undefined
              }
            >
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  aria-invalid={tooShort || undefined}
                  required
                  minLength={mode === 'register' ? PASSWORD_MIN_LENGTH : undefined}
                  maxLength={128}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={pending === mode}
              disabled={pending !== null || tooShort}
            >
              {mode === 'signin' ? <LogIn /> : <UserPlus />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {SHOW_DEMO_ACCOUNTS && (
            <>
              <div className="my-7 flex items-center gap-3 text-xs text-subtle">
                <div className="h-px flex-1 bg-border" /> or use a demo account{' '}
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-2">
                {DEMO_USERS.map((user) => (
                  <button
                    key={user.email}
                    onClick={() => run(user.email, () => login(user.email, DEMO_PASSWORD))}
                    disabled={pending !== null}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left shadow-xs transition hover:border-brand/50 hover:shadow-md disabled:opacity-60',
                      pending === user.email && 'border-brand/60',
                    )}
                  >
                    <div
                      className={cn(
                        'grid size-9 place-items-center rounded-full bg-gradient-to-br text-sm font-semibold text-white',
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
              <p className="mt-3 text-center text-xs text-subtle">
                Demo password: <span className="font-mono">{DEMO_PASSWORD}</span>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
