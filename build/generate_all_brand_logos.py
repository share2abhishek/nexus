import os
import subprocess

# The razor-sharp mathematical vector paths from icon.svg
PATH_DATA = '''M 108.30 185.81 C 110.68 185.46, 115.15 185.07, 119.04 183.93 C 122.92 182.78, 127.79 180.90, 131.63 178.93 C 135.47 176.96, 138.39 175.08, 142.05 172.11 C 145.71 169.13, 150.40 164.77, 153.59 161.08 C 156.79 157.40, 159.13 153.75, 161.23 149.99 C 163.33 146.23, 164.95 142.79, 166.19 138.51 C 167.44 134.23, 168.29 128.52, 168.71 124.31 C 169.12 120.11, 169.17 117.70, 168.68 113.28 C 168.18 108.86, 167.47 102.92, 165.73 97.77 C 164.00 92.62, 164.98 91.19, 158.25 82.39 C 151.53 73.59, 131.73 48.58, 125.39 44.96 C 119.05 41.34, 122.28 56.20, 120.22 60.69 C 118.16 65.17, 114.30 68.18, 113.02 71.87 C 111.75 75.56, 109.99 77.31, 112.55 82.83 C 115.12 88.34, 125.02 98.12, 128.44 104.96 C 131.85 111.79, 131.44 120.26, 133.04 123.86 C 134.63 127.47, 136.31 126.59, 138.01 126.56 C 139.70 126.53, 142.23 126.46, 143.20 123.70 C 144.17 120.95, 144.57 114.50, 143.83 110.05 C 143.08 105.60, 141.80 102.21, 138.72 97.01 C 135.64 91.82, 127.39 82.79, 125.34 78.88 C 123.29 74.97, 125.64 75.19, 126.40 73.56 C 127.16 71.92, 126.33 66.32, 129.91 69.05 C 133.50 71.78, 143.87 84.19, 147.90 89.94 C 151.93 95.69, 152.81 99.76, 154.12 103.53 C 155.43 107.31, 155.58 108.65, 155.77 112.60 C 155.96 116.55, 156.17 122.26, 155.26 127.26 C 154.36 132.25, 152.04 138.57, 150.34 142.56 C 148.64 146.56, 148.03 147.77, 145.08 151.22 C 142.13 154.68, 135.82 160.59, 132.65 163.30 C 129.48 166.00, 129.36 165.95, 126.06 167.44 C 122.77 168.93, 116.67 171.22, 112.89 172.24 C 109.12 173.25, 107.33 173.49, 103.42 173.54 C 99.51 173.58, 94.36 173.59, 89.41 172.50 C 84.46 171.41, 77.63 168.81, 73.73 167.01 C 69.84 165.21, 67.36 162.89, 66.03 161.70 C 64.70 160.50, 63.70 160.64, 65.76 159.84 C 67.81 159.04, 73.80 156.64, 78.36 156.91 C 82.91 157.18, 89.05 160.66, 93.09 161.46 C 97.14 162.27, 100.65 161.94, 102.65 161.74 C 104.65 161.53, 104.47 161.15, 105.10 160.23 C 105.72 159.31, 106.65 157.85, 106.40 156.24 C 106.16 154.64, 107.53 152.42, 103.64 150.58 C 99.74 148.74, 88.98 145.54, 83.04 145.19 C 77.09 144.85, 69.77 150.10, 67.97 148.51 C 66.16 146.91, 72.00 140.27, 72.22 135.63 C 72.43 131.00, 69.29 125.86, 69.26 120.71 C 69.24 115.57, 65.66 114.45, 72.07 104.76 C 78.48 95.07, 100.69 71.76, 107.72 62.58 C 114.76 53.40, 113.02 53.76, 114.26 49.67 C 115.51 45.58, 115.28 40.92, 115.19 38.03 C 115.09 35.15, 115.31 35.43, 113.68 32.37 C 112.05 29.30, 107.72 22.68, 105.40 19.62 C 103.07 16.56, 104.17 10.52, 99.73 14.00 C 95.28 17.48, 88.28 29.18, 78.74 40.48 C 69.19 51.77, 50.05 71.40, 42.45 81.75 C 34.84 92.10, 34.97 95.90, 33.11 102.57 C 31.25 109.24, 31.28 116.44, 31.29 121.76 C 31.30 127.09, 32.12 130.37, 33.16 134.54 C 34.21 138.70, 36.02 143.29, 37.56 146.77 C 39.10 150.24, 39.86 151.93, 42.38 155.39 C 44.91 158.85, 48.28 163.60, 52.72 167.52 C 57.17 171.43, 64.24 176.11, 69.07 178.88 C 73.90 181.64, 75.73 182.91, 81.69 184.10 C 87.64 185.29, 100.37 185.72, 104.81 186.00 C 109.24 186.28, 105.93 186.15, 108.30 185.81 Z M 54.74 150.47 C 53.45 147.88, 49.02 140.48, 47.27 135.43 C 45.52 130.38, 44.61 124.67, 44.24 120.16 C 43.87 115.64, 44.32 112.10, 45.06 108.33 C 45.80 104.57, 46.44 102.08, 48.70 97.57 C 50.96 93.07, 52.64 88.79, 58.64 81.31 C 64.64 73.83, 78.00 60.42, 84.68 52.69 C 91.37 44.95, 96.08 37.81, 98.76 34.88 C 101.44 31.96, 100.16 34.35, 100.75 35.14 C 101.35 35.92, 102.22 37.38, 102.34 39.59 C 102.46 41.79, 103.18 44.64, 101.48 48.36 C 99.78 52.08, 98.25 54.60, 92.17 61.92 C 86.09 69.23, 70.38 85.80, 65.00 92.26 C 59.61 98.72, 61.26 97.36, 59.86 100.67 C 58.46 103.98, 57.21 108.91, 56.60 112.13 C 56.00 115.34, 56.18 117.44, 56.25 119.97 C 56.32 122.50, 56.26 124.28, 57.05 127.31 C 57.83 130.35, 60.92 134.58, 60.98 138.19 C 61.03 141.80, 58.16 146.82, 57.40 148.96 C 56.63 151.09, 56.78 150.67, 56.39 151.00 C 56.00 151.33, 55.31 151.03, 55.04 150.94 C 54.76 150.85, 56.04 153.05, 54.74 150.47 Z M 122.19 156.34 C 124.16 154.87, 129.42 150.88, 132.11 148.21 C 134.80 145.55, 137.29 142.40, 138.33 140.37 C 139.36 138.33, 138.63 137.09, 138.31 135.99 C 137.98 134.88, 137.98 134.19, 136.37 133.75 C 134.76 133.30, 131.29 131.91, 128.66 133.32 C 126.02 134.74, 123.28 139.76, 120.55 142.23 C 117.82 144.70, 113.75 146.72, 112.26 148.15 C 110.78 149.58, 111.38 149.58, 111.64 150.83 C 111.91 152.08, 112.43 154.63, 113.88 155.66 C 115.32 156.69, 118.92 156.90, 120.30 157.02 C 121.69 157.13, 120.22 157.80, 122.19 156.34 Z'''

CIRCLES = '''
    <circle cx="84.34" cy="118.56" r="4.96" fill="url(#dropGrad)" />
    <circle cx="99.75" cy="118.56" r="4.96" fill="url(#dropGrad)" />
    <circle cx="117.49" cy="118.56" r="4.96" fill="url(#dropGrad)" />
'''

def make_horizontal_logo(theme='auto', width=800, height=210):
    # theme: 'auto', 'dark', 'light'
    if theme == 'auto':
        nexa_style = '''
      .brand-nexa { fill: #0f172a; }
      .brand-tagline { fill: #64748b; }
      @media (prefers-color-scheme: dark) {
        .brand-nexa { fill: #ffffff; }
        .brand-tagline { fill: #94a3b8; }
      }
        '''
    elif theme == 'dark':
        nexa_style = '''
      .brand-nexa { fill: #ffffff; }
      .brand-tagline { fill: #94a3b8; }
        '''
    else: # light
        nexa_style = '''
      .brand-nexa { fill: #0f172a; }
      .brand-tagline { fill: #64748b; }
        '''

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%" shape-rendering="geometricPrecision">
  <defs>
    <linearGradient id="dropGrad" x1="15%" y1="5%" x2="85%" y2="95%">
      <stop offset="0%" stop-color="#00f0ff" />
      <stop offset="35%" stop-color="#00a8ff" />
      <stop offset="70%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#8b5cf6" />
    </linearGradient>
    <linearGradient id="dripGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00f0ff" />
      <stop offset="40%" stop-color="#00b4d8" />
      <stop offset="100%" stop-color="#0072ff" />
    </linearGradient>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;800&amp;display=swap');
      {nexa_style}
      .brand-nexa, .brand-drip {{
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 800;
        font-size: 104px;
        letter-spacing: -0.03em;
      }}
      .brand-drip {{
        fill: url(#dripGrad);
      }}
      .brand-tagline {{
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 500;
        font-size: 26px;
        letter-spacing: 0.01em;
      }}
    </style>
  </defs>
  
  <!-- Droplet Mark -->
  <g transform="translate(12, 10) scale(0.95)">
    <path d="{PATH_DATA}" fill="url(#dropGrad)" fill-rule="evenodd" />
    {CIRCLES}
  </g>
  
  <!-- Brand Typography (Enlarged & Prominent) -->
  <g transform="translate(215, 126)">
    <text x="0" y="0">
      <tspan class="brand-nexa">Nexa</tspan>
      <tspan class="brand-drip">Drip</tspan>
    </text>
    <text x="4" y="46" class="brand-tagline">Digital Marketing &amp; Bot Platform</text>
  </g>
</svg>'''
    return svg

def make_stacked_logo(width=520, height=440):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%" shape-rendering="geometricPrecision">
  <defs>
    <linearGradient id="dropGrad" x1="15%" y1="5%" x2="85%" y2="95%">
      <stop offset="0%" stop-color="#00f0ff" />
      <stop offset="35%" stop-color="#00a8ff" />
      <stop offset="70%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#8b5cf6" />
    </linearGradient>
    <linearGradient id="dripGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00f0ff" />
      <stop offset="40%" stop-color="#00b4d8" />
      <stop offset="100%" stop-color="#0072ff" />
    </linearGradient>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;800&amp;display=swap');
      .brand-nexa {{
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-weight: 800;
        font-size: 92px;
        letter-spacing: -0.03em;
        fill: #ffffff;
      }}
      .brand-drip {{
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-weight: 800;
        font-size: 92px;
        letter-spacing: -0.03em;
        fill: url(#dripGrad);
      }}
      .brand-tagline {{
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-weight: 500;
        font-size: 23px;
        letter-spacing: 0.01em;
        fill: #94a3b8;
      }}
    </style>
  </defs>
  
  <!-- Droplet Mark Centered -->
  <g transform="translate(155, 20) scale(1.05)">
    <path d="{PATH_DATA}" fill="url(#dropGrad)" fill-rule="evenodd" />
    {CIRCLES}
  </g>
  
  <!-- Centered Brand Typography -->
  <g transform="translate(260, 320)">
    <text text-anchor="middle">
      <tspan class="brand-nexa">Nexa</tspan>
      <tspan class="brand-drip">Drip</tspan>
    </text>
    <text x="0" y="44" text-anchor="middle" class="brand-tagline">Digital Marketing &amp; Bot Platform</text>
  </g>
</svg>'''
    return svg

def main():
    os.makedirs('nexus/public', exist_ok=True)
    
    with open('nexus/public/logo.svg', 'w', encoding='utf-8') as f:
        f.write(make_horizontal_logo('auto'))
    print('Wrote logo.svg')

    with open('nexus/public/logo-dark.svg', 'w', encoding='utf-8') as f:
        f.write(make_horizontal_logo('dark'))
    print('Wrote logo-dark.svg')

    with open('nexus/public/logo-light.svg', 'w', encoding='utf-8') as f:
        f.write(make_horizontal_logo('light'))
    print('Wrote logo-light.svg')

    with open('nexus/public/logo-stacked.svg', 'w', encoding='utf-8') as f:
        f.write(make_stacked_logo())
    print('Wrote logo-stacked.svg')

if __name__ == '__main__':
    main()
