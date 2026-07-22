import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow"
      >
        <h1 className="text-xl font-bold text-gray-900">SdG — Polcecal / Polysan</h1>
        <p className="text-sm text-gray-500">Ingresá con tu cuenta.</p>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
          <input
            id="email" name="email" type="email" required
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-gray-700">Contraseña</label>
          <input
            id="password" name="password" type="password" required
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800"
        >
          Ingresar
        </button>
      </form>
    </main>
  );
}
