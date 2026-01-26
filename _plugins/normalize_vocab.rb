require 'yaml'

# Load the original vocabulary data
vocab_path = File.join(__dir__, '..', '_data', 'vocabulary.yml')
vocab = YAML.load_file(vocab_path)

# Add a lowercase key to each entry
normalized_vocab = vocab.map do |entry|
  entry['term_lc'] = entry['term'].downcase
  entry
end

# Save to a new file (or overwrite the original if preferred)
output_path = File.join(__dir__, '..', '_data', 'vocabulary_normalized.yml')
File.open(output_path, 'w') { |file| file.write(normalized_vocab.to_yaml) }

puts "✅ Vocabulary normalized and saved to vocabulary_normalized.yml"