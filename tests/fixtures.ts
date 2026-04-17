export const CLEAN_WORKFLOW = `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo hello
`;

export const WITH_SECRETS = `name: Deploy
on: push
env:
  GLOBAL_TOKEN: \${{ secrets.GLOBAL }}
jobs:
  build:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Use secret
        env:
          API_KEY: \${{ secrets.API_KEY }}
        run: deploy
`;

export const WITH_VARIABLES = `name: Build
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: configure
        env:
          REGION: \${{ vars.REGION }}
          NODE_VERSION: \${{ vars.NODE_VERSION }}
        run: echo $REGION
`;

export const WITH_ENVIRONMENTS = `name: Envs
on: push
jobs:
  prod:
    runs-on: ubuntu-latest
    environment: production
    steps: [{ run: echo }]
  stg:
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.example.com
    steps: [{ run: echo }]
  dynamic:
    runs-on: ubuntu-latest
    environment: \${{ github.event.inputs.env }}
    steps: [{ run: echo }]
`;

export const WITH_ACTIONS = `name: Actions
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./local-action
      - uses: docker://alpine:3.18
      - uses: actions/setup-node@v2
      - uses: actions/upload-artifact@main
`;

export const WITH_EXPRESSIONS = `name: Expr
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    if: \${{ contains(github.event.labels.*.name, 'bug') }}
    steps:
      - if: \${{ contain(github.event.labels, 'x') }}
        run: echo typo
      - if: \${{ }}
        run: echo empty
      - if: \${{ startsWith(github.ref, 'refs/tags/') }}
        run: echo good
`;

export const WITH_CIRCULAR_NEEDS = `name: Circ
on: push
jobs:
  a:
    needs: b
    runs-on: ubuntu-latest
    steps: [{ run: echo a }]
  b:
    needs: a
    runs-on: ubuntu-latest
    steps: [{ run: echo b }]
`;

export const WITH_MISSING_NEEDS = `name: MN
on: push
jobs:
  deploy:
    needs: ghost
    runs-on: ubuntu-latest
    steps: [{ run: echo deploy }]
`;

export const WITH_CONTINUE_ON_ERROR_NEEDS = `name: Coe
on: push
jobs:
  flaky:
    continue-on-error: true
    runs-on: ubuntu-latest
    steps: [{ run: exit 1 }]
  downstream:
    needs: flaky
    runs-on: ubuntu-latest
    steps: [{ run: echo downstream }]
`;

export const WITH_DEPRECATED_RUNNERS = `name: DR
on: push
jobs:
  old-ubuntu:
    runs-on: ubuntu-18.04
    steps: [{ run: echo }]
  old-macos:
    runs-on: macos-10.15
    steps: [{ run: echo }]
  matrix:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    steps: [{ run: echo }]
  self:
    runs-on: [self-hosted, linux, x64]
    steps: [{ run: echo }]
`;

export const WITH_BAD_PERMISSIONS = `name: BP
on: push
permissions: write-all
jobs:
  a:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      bogus-scope: write
      issues: wrong-value
    steps:
      - uses: actions/checkout@v4
`;

export const WITH_EMPTY_PERMS_GH_SCRIPT = `name: GHS
on: push
jobs:
  scripter:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - uses: actions/github-script@v7
        with:
          script: console.log('hi')
`;

export const BROKEN_YAML = `name: Broken
on: push
jobs:
  x:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: [this is: not valid
`;

export const MISSING_REQUIRED_KEYS = `# deliberately missing on: and jobs:
env:
  FOO: bar
`;

export const JOB_MISSING_RUNS_ON = `name: Missing
on: push
jobs:
  build:
    steps:
      - run: echo hi
`;

export const JOB_WITHOUT_STEPS = `name: Empty
on: push
jobs:
  empty-job:
    runs-on: ubuntu-latest
`;

export const REUSABLE_WORKFLOW_CALL = `name: Reusable
on: push
jobs:
  call:
    uses: ./.github/workflows/build.yml
    with:
      foo: bar
`;

export const COMPREHENSIVE_BAD = `on: push
permissions: write-all
jobs:
  bad:
    runs-on: ubuntu-16.04
    environment: Prod
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@master
      - name: deploy
        env:
          K: \${{ secrets.MISSING_SEC }}
          R: \${{ vars.MISSING_VARR }}
          X: \${{ contan(github.event.labels.*.name, 'bug') }}
        run: deploy
  circular-a:
    needs: circular-b
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  circular-b:
    needs: circular-a
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  orphan:
    needs: does-not-exist
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
`;
