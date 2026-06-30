import { CreditCard } from 'lucide-react';
export default function AccountSection(){
return (
<div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
<h2 className="text-2xl font-semibold text-white">Cuenta</h2>
<p className="text-white/60 mb-6">Administrá tu plan, facturación y suscripción.</p>
<div className="grid gap-6 lg:grid-cols-3">
<div className="rounded-2xl border border-cyan-500/20 p-5">
<div className="text-white font-semibold">Individual</div><div className="text-3xl font-bold">$19.900</div><div className="text-white/60">1 sucursal · hasta 3 profesionales</div>
</div>
<div className="rounded-2xl border border-violet-500 p-5">
<div className="text-violet-300 font-semibold">Más elegido</div><div className="text-white font-semibold">Negocio</div><div className="text-3xl font-bold">$29.900</div><div className="text-white/60">3 sucursales · hasta 20 profesionales</div>
</div>
<div className="rounded-2xl border border-amber-500/30 p-5">
<div className="text-white font-semibold">Cadena</div><div className="text-3xl font-bold">$59.900</div><div className="text-white/60">Sucursales y profesionales ilimitados</div>
</div>
</div>
<div className="mt-6 rounded-2xl border border-white/10 p-5 flex items-center gap-4">
<CreditCard className="text-cyan-400"/>
<div><div className="text-white font-medium">Estado: Activa</div><div className="text-white/60">Próximo pago: 29 Jul 2026 · Visa ****4821</div></div>
</div>
</div>);
}
