export function FieldError({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} role="alert" className="text-sm text-problem">
      {children}
    </p>
  )
}
