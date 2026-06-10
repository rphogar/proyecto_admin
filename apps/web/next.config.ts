import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Consume los paquetes del monorepo directamente desde su fuente compilada.
  transpilePackages: ['@contave/shared', '@contave/ledger', '@contave/fiscal-engine'],
};

export default nextConfig;
