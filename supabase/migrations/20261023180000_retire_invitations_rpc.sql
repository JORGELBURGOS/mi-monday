-- Las invitaciones por email se reemplazaron por cuentas creadas por un
-- administrador. La función queda en la base (no se elimina nada) pero ya no
-- se puede invocar desde la API.
revoke execute on function public.respond_to_invitation(uuid, boolean) from authenticated, anon, public;
