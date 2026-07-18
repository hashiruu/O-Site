const nextJest = require('next/jest')

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
    },
    // 排除旧项目快照目录
    testPathIgnorePatterns: ['/node_modules/', '/transcoder-5090/'],
}

// next/jest 会强制设置 transformIgnorePatterns 排除整个 node_modules，
// 但 uuid v13 只发布 ESM，必须放行给 SWC 转译，因此在生成配置后打补丁
module.exports = async () => {
    const config = await createJestConfig(customJestConfig)()
    config.transformIgnorePatterns = [
        '/node_modules/(?!(uuid)/)',
        '^.+\\.module\\.(css|sass|scss)$',
    ]
    return config
}
