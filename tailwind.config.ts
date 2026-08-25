import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#12151a',
        paper: '#fbfaf8',
      },
    },
  },
  plugins: [],
}

export default config
