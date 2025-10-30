require 'yaml'

# Load the original vocabulary data
vocab_path = '_data/vocabulary.yml'
vocab = YAML.load_file(vocab_path)

# Add a lowercase key to each entry
normalized_vocab = vocab.map do |entry|
  entry['term_lc'] = entry['term'].downcase
  entry
end

# Save to a new file (or overwrite the original if preferred)
File.open('_data/vocabulary_normalized.yml', 'w') do |file|
  file.write(normalized_vocab.to_yaml)
end

puts "✅ Vocabulary normalized and saved to vocabulary_normalized.yml"