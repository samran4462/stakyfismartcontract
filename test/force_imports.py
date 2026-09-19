import os

TEST_DIR = "test"
esm_import = 'import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";\n'

for file in ["ClaimExecution.test.js", "UnstakingPenalties.test.js", "RewardEngine.test.js", "RewardPool.test.js"]:
    filepath = os.path.join(TEST_DIR, file)
    with open(filepath, 'r') as f:
        content = f.read()
    
    if "helpers.js" not in content:
        content = content.replace('import hre from "hardhat";\n', 'import hre from "hardhat";\n' + esm_import)
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Fixed {filepath}")
