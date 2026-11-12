FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY DocuMind.csproj ./
RUN dotnet restore

COPY . ./
RUN dotnet publish DocuMind.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

COPY --from=build /app/publish ./
RUN install -d -o app -g app /app/storage /app/keys

EXPOSE 8080

ENTRYPOINT ["dotnet", "DocuMind.dll"]
