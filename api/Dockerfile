FROM mcr.microsoft.com/dotnet/sdk:9.0

WORKDIR /src

# Restore deps first for better layer caching
COPY *.csproj ./
RUN dotnet restore

EXPOSE 8080

# dotnet watch for hot reload on file changes (volume-mounted from host)
CMD ["dotnet", "watch", "run", "--no-launch-profile", "--urls", "http://+:8080"]
