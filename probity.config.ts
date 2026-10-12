import { defineConfig, enforceTdd } from '@nizos/probity'

// アプリ本体だけ TDD を強制する。scripts/ や data/ の分析・生成物は対象外
export default defineConfig({
  rules: [
    {
      files: ['lib/**', 'app/**', 'components/**'],
      rules: [enforceTdd()],
    },
  ],
})
