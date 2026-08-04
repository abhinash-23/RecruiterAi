import { AppRoutes } from "@/app/router"
import { Providers } from "@/app/providers"

export function App() {
  return (
    <Providers>
      <AppRoutes />
    </Providers>
  )
}

export default App
