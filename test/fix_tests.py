import os
import re

TEST_DIR = "."

helpers_import = 'const { setRewardRateHelper, addLoyaltyTierHelper, setStakingFeeHelper, setUnstakingPenaltyHelper } = require("./helpers");\n'

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original_content = content

    if "helpers" not in content:
        # Add import after hardhat
        content = content.replace('import hre from "hardhat";\n', 'import hre from "hardhat";\n' + helpers_import)

    content = re.sub(r'await\s+staking\.connect\(([^)]+)\)\.setRewardRate\(([^)]+),\s*([^)]+)\)', 
                     r'await setRewardRateHelper(staking, \1, \2, \3)', content)
                     
    content = re.sub(r'await\s+staking\.connect\(([^)]+)\)\.addLoyaltyTier\(([^)]+),\s*([^)]+)\)', 
                     r'await addLoyaltyTierHelper(staking, \1, \2, \3)', content)

    # Some tests do expect(staking.connect(manager).setStakingFee...). 
    # The helper takes time.increase, so expect(helper()).to.be.reverted is fine as long as the revert happens in propose.
    # Actually, if we expect revert, the propose will revert, time won't increase! That's perfect.
    content = re.sub(r'staking\.connect\(([^)]+)\)\.setStakingFee\(([^)]+),\s*([^)]+),\s*([^)]+)\)', 
                     r'setStakingFeeHelper(staking, \1, \2, \3, \4)', content)

    content = re.sub(r'staking\.connect\(([^)]+)\)\.setUnstakingPenalty\(([^)]+),\s*([^)]+),\s*([^)]+),\s*([^)]+)\)', 
                     r'setUnstakingPenaltyHelper(staking, \1, \2, \3, \4, \5)', content)

    # Note: the above regexes match both await and expect() by not requiring await in the last two.
    
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Fixed {filepath}")

for root, _, files in os.walk(TEST_DIR):
    for file in files:
        if file.endswith('.test.js') and file not in ["Timelock.test.js", "MaximumCaps.test.js", "AdminRoles.test.js"]:
            process_file(os.path.join(root, file))
