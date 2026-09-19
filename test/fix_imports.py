import os

TEST_DIR = "test"
old_import = 'const { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } = require("./helpers");'
new_import = 'import { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } from "./helpers.js";'

for file in os.listdir(TEST_DIR):
    if file.endswith('.test.js'):
        filepath = os.path.join(TEST_DIR, file)
        with open(filepath, 'r') as f:
            content = f.read()
        
        if old_import in content:
            content = content.replace(old_import, new_import)
            with open(filepath, 'w') as f:
                f.write(content)
            print(f"Fixed {filepath}")
